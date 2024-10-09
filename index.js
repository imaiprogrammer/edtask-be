import express, { json } from 'express';
import multer from 'multer';
import cors from 'cors';
import mongoose from 'mongoose';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import http from 'http';
import connectDB from './db.js';
import parseCSV from './utility/csvparser.js';
// Import of Schema Models
import RegistrationModel from './models/RegisterationModel.js';
import StudentModel from './models/StudentModel.js';
import InstructorModel from './models/InstructorModel.js';
import ClassTypeModel from './models/ClassTypeModel.js';

const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.REACT_APP_BASE_URL || 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true
    }
});

io.on('connection', (socket) => {
    console.log(`socket  ${socket.id} connected`);
    // io.to(socket.id).emit('record_upload_status', { message: `socket  ${socket.id} connected` });

    socket.on('disconnect', () => {
        console.log('socket disconnected');
    });
});

app.use(json());

app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const upload = multer({ dest: 'uploads/' });

// Initialize Db Connection
const db = connectDB();

const classDuration = process.env.CLASS_DURATION_MINUTES || 45;
const FAILED_STATUS = 'failed';
const SUCCESS_STATUS = 'success';

// Be careful of overlapping sessions (so if i send a request to schedule a class for student A and instructor I at 12:30 PM, and the duration is 45 minutes), API shouldn't allow (rejects the row with a return reason if the class is being scheduled for instructor I at before 12:30 + 45 minutes).
const classOverlapCheck = async (studentId, instructorId, classTime) => {
    const studentOverlapped = await RegistrationModel.findOne({
        studentId,
        startTime: { $lt: new Date(classTime.getTime() + classDuration * 60000), $gte: classTime }
    });
    const instructorOverlapped = await RegistrationModel.findOne({
        instructorId,
        startTime: { $lt: new Date(classTime.getTime() + classDuration * 60000), $gte: classTime }
    });

    if (studentOverlapped || instructorOverlapped) {
        return true;
    }
    return false;
};

const checkForStudent = async (studentId) => {
    let student = await StudentModel.findOne({ studentId });
    if (!student) {
        student = new StudentModel({
            studentId,
            name: `JohnDoe ${studentId}`,
            email: `john${studentId}@drive.com`,
        });
        await student.save();
        return { student, message: `New student added: ${studentId}` };
    }
    return { student, message: null };
}

const checkForInstructor = async (instructorId) => {
    let instructor = await InstructorModel.findOne({ instructorId });
    if (!instructor) {
        instructor = new InstructorModel({
            instructorId,
            name: `Instructor ${instructorId}`,
            email: `Mike${instructorId}@drive.com`
        });
        await instructor.save();
        return { instructor, message: `New instructor added: ${instructorId}` };
    }
    return { instructor, message: null };
}

const checkForClass = async (classId) => {
    const classType = await ClassTypeModel.findOne({ classId });
    if (!classType) {
        const newClassType = new ClassTypeModel({
            classId,
            className: `Class ${classId}`,
            description: `Description for class ${classId}`
        });
        await newClassType.save();
        return { classType: newClassType._doc, message: `New class added: ${classId}` };
    }
    return { classType, message: null };
};

// Api Request Route for registration
app.post('/registration', upload.single('file'), async (req, res) => {
    const { name, email, socketId } = req.body;
    const file = req.file;

    const today = new Date().setHours(0, 0, 0, 0);

    const responses = [];

    if (!file) {
        return res.status(400).send('No file uploaded');
    }

    const filePath = join(__dirname, 'uploads', file.filename);
    const parsedRows = await parseCSV(filePath);
    for (const [index, row] of parsedRows.entries()) {
        const registrationId = row['Registration ID'];
        const studentId = row['Student ID'];
        const instructorId = row['Instructor ID'];
        const classId = row['Class ID'];
        const startTime = row['Class Start Time'];
        const action = row['Action'];
        console.log(`Emitting to socketId: ${socketId}`);
        try {
            let responseMessage;
            let responseStatus = FAILED_STATUS;
            switch (action) {
                case 'new':
                    try {
                        // If the csv contains a student ID not in the master list, append to the student ID;
                        const { message: studentMessage } = await checkForStudent(studentId);
                        if (studentMessage) {
                            responseMessage = studentMessage;
                            responses.push({ row, message: studentMessage });
                        }

                        // If the csv contains a instructor ID not in the master list, append to the Instructor ID;
                        const { message: instructorMessage } = await checkForInstructor(instructorId);
                        if (classMessage) {
                            responseMessage = instructorMessage;
                            responses.push({ row, message: instructorMessage });
                        }

                        // If the csv contains a class ID not in the master list, append to the Class ID;
                        const { message: classMessage } = await checkForClass(classId);
                        if (classMessage) {
                            responseMessage = classMessage;
                            responses.push({ row, message: classMessage });
                        }

                        // A student cannot schedule more than 'x' classes in a day (should be configurable via env variables).
                        const STUDENT_MAX_CLASSES = process.env.STUDENT_MAX_CLASSES || 5;

                        const studentClassCount = await RegistrationModel.countDocuments({ studentId, startTime: { $gte: today } });

                        if (studentClassCount >= STUDENT_MAX_CLASSES) {
                            responseMessage = `A student cannot schedule more than ${STUDENT_MAX_CLASSES} classes in a day `
                            responses.push({ row, message: responseMessage });
                            continue;
                        }

                        // An instructor cannot have more than 'y' classes in a day (should be configurable via env variables).
                        const INSTRUCTOR_MAX_CLASSES = process.env.INSTRUCTOR_MAX_CLASSES || 5;
                        const instructorClassCount = await RegistrationModel.countDocuments({ instructorId, startTime: { $gte: today } });

                        if (instructorClassCount >= INSTRUCTOR_MAX_CLASSES) {
                            responseMessage = `An instructor cannot have more than ${INSTRUCTOR_MAX_CLASSES} classes in a day`;
                            responses.push({ row, message: responseMessage });
                            continue;
                        }

                        // Fetching count of class type if specific class type for today
                        const classTypeCount = await RegistrationModel.countDocuments({
                            classId: classId,
                            startTime: { $gte: today },
                        });

                        const MAX_CLASSES_PER_CLASS_TYPE = process.env.MAX_CLASSES_PER_CLASS_TYPE || 5;
                        // Maximum number of classes 'c' per class-type that can be scheduled in a day 
                        if (classTypeCount >= MAX_CLASSES_PER_CLASS_TYPE) {
                            responseMessage = `Maximum number of classes for this class type (${classId}) has been reached. Maximum allowed: ${MAX_CLASSES_PER_CLASS_TYPE}`;
                            return res.status(400).json({
                                message: responseMessage
                            });
                        }

                        //check for overlapping sessions
                        const classTime = new Date(startTime);
                        const isClassOverlapped = await classOverlapCheck(studentId, instructorId, classTime);
                        if (isClassOverlapped) {
                            responseMessage = 'Classes overlaps with another one';
                            responses.push({ row, message: 'Classes overlaps with another one' });
                            continue;
                        }

                        const registerNew = new RegistrationModel({
                            studentId,
                            instructorId,
                            classId,
                            startTime,
                            duration: process.env.CLASS_DURATION || 60, // Duration of class is 'm' minutes (should be configurable via env variables).
                        });
                        await registerNew.save();
                        responseMessage = `${registerNew._id} registered successfully.`;
                        responseStatus = SUCCESS_STATUS
                        // io.to(socketId).emit('record_upload_status', { index, row, status: SUCCESS_STATUS, message: `${registerNew._id} registered successfully.` });
                        responses.push({ row, message: 'Registration successful', registrationId: registerNew._id });
                    } catch (error) {
                        io.to(socketId).emit('record_upload_status', { index, row, status: FAILED_STATUS, message: 'Registration failed' });
                        responses.push({ row, message: 'Registration failed' });
                    }
                    break;
                case 'update':
                    if (!mongoose.isValidObjectId(registrationId)) {
                        responseMessage = `Invalid ObjectId: ${registrationId}`;
                        responses.push({ row, message: responseMessage });
                        continue;
                    }
                    try {
                        const record = await RegistrationModel.findOne({ _id: registrationId }).lean() // Assuming that registrationId is the objectId 
                        if (record) {
                            record.studentId = studentId;
                            record.instructorId = instructorId;
                            record.classId = classId;
                            record.startTime = startTime;
                            await record.save();
                            // io.to(socketId).emit('record_upload_status', { index, row, status: SUCCESS_STATUS, message: `${record._id} updated successfully.` });
                            responseMessage = `${record._id} updated successfully.`;
                            responseStatus = SUCCESS_STATUS;
                            responses.push({ row, message: responseMessage });
                        } else {
                            responseMessage = 'Record not found';
                            // io.to(socketId).emit('record_upload_status', { index, row, status: FAILED_STATUS, message: 'Record not found' });
                            responses.push({ row, message: responseMessage });
                        }
                    } catch (error) {
                        responseMessage = `Error updating record: ${error.message}`;
                        // io.to(socketId).emit('record_upload_status', { index, row, status: FAILED_STATUS, message: `Error updating record: ${error.message}` });
                        responses.push({ row, message: responseMessage });
                    }
                    break;
                case 'delete':
                    if (!mongoose.isValidObjectId(registrationId)) {
                        responseMessage = `Invalid ObjectId: ${registrationId}`;
                        responses.push({ row, message: res });
                        continue;
                    }
                    try {
                        const record = await RegistrationModel.deleteOne({ _id: registrationId })
                        if (!record) {
                            responseMessage = `Record not found for ID: ${registrationId}`;
                            // io.to(socketId).emit('record_upload_status', { index, row, status: FAILED_STATUS, message: `Record not found for ID: ${registrationId}` });
                            responses.push({ row, message: responseMessage });
                        } else {
                            responseMessage = 'Record deleted successfully';
                            // io.to(socketId).emit('record_upload_status', { index, row, status: SUCCESS_STATUS, message: 'record deleted successfully.' });
                            responses.push({ row, message: responseMessage });
                        }
                    } catch (error) {
                        responseMessage = `Error deleting record: ${error.message}`;
                        // io.to(socketId).emit('record_upload_status', { index, row, status: FAILED_STATUS, message: `Failed to delete record` });
                        responses.push({ row, message: responseMessage });
                    }
                    break;
                default:
            }
            console.log(` Socket id ${socketId}`);
            console.log('Responses...', JSON.stringify(responses));

            io.to(socketId).emit('record_upload_status', { index, row, message: responseMessage });
        } catch (error) {
            console.log('Error in processing records', error);
            io.to(socketId).emit('record_upload_status', { index, row, status: FAILED_STATUS, message: 'Error in processing records' });
        }
    }
    // Mocking 15 seconds delay to check socket working
    setTimeout(() => {
        res.status(200).json(responses);
    }, 15000);
});

// Just one time insertion of dummy records
app.post('/bulk-insert', async (req, res) => {
    try {
        // Inserting dummy students
        await StudentModel.insertMany([
            { studentId: '12398', name: 'John Doe', email: 'john@demo.com' },
            { studentId: '124213', name: 'Jane', email: 'jane@demo.com' },
        ]);

        // Inserting dummy instructors
        await InstructorModel.insertMany([
            { instructorId: '111', name: 'Bob', email: 'bob@drive.com', expertise: 'Driving' },
            { instructorId: '112', name: 'Alice', email: 'alice@drive.com', expertise: 'Theory' },
        ]);

        // Inserting dummy classtypes
        await ClassTypeModel.insertMany([
            { classId: '101', className: 'Driving Basics', description: 'Introduction to driving basics.' },
            { classId: '201', className: 'Advanced Driving', description: 'Advanced driving techniques.' },
        ]);
    } catch (exception) {
        console.log('Error while insertion', exception);
    }
    res.status(200).send('Dummy records are inserted');
});

// Day wise scheduled classes
app.get('/daywise-classes', async (req, res) => {
    try {
        const classData = await RegistrationModel.aggregate([
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$startTime' },
                    },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const formattedClassData = classData.map((item) => ({
            date: item._id,
            count: item.count,
        }));

        res.status(200).json(formattedClassData);
    } catch (exception) {
        res.status(500).json({ message: 'Error fetching class data', error: error.message });
    }
})

// Fetching all classes
app.get('/classes', async (req, res) => {
    try {
        const classTypes = await ClassTypeModel.find().lean();
        res.status(200).json(classTypes);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching class data', error: error.message });
    }
});

// Fetching all registrations with classes and instructors
app.get('/registrations-list', async (req, res) => {
    try {
        const registrationRecords = await RegistrationModel.aggregate([
            {
                $lookup: {
                    from: 'classtypes',
                    localField: 'classId',
                    foreignField: 'classId',
                    as: 'classDetails',
                },
            },
            {
                $lookup: {
                    from: 'instructors',
                    localField: 'instructorId',
                    foreignField: 'instructorId',
                    as: 'instructorDetails',
                }
            },
            {
                $unwind: {
                    path: '$classDetails',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $unwind: {
                    path: '$instructorDetails',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    classId: 1,
                    studentId: 1,
                    startTime: 1,
                    instructorInfo: {
                        instructorId: '$instructorDetails.instructorId',
                        name: '$instructorDetails.name',
                        email: '$instructorDetails.email',
                        expertise: '$instructorDetails.expertise'
                    },
                    classInfo: {
                        classId: '$classDetails.classId',
                        className: '$classDetails.className',
                        description: '$classDetails.description'
                    }
                }
            }
        ]);
        res.status(200).json(registrationRecords);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching registration records', error: error.message });
    }
});


// Fetching all instructors
app.get('/instructors', async (req, res) => {
    try {
        const instructors = await InstructorModel.find().lean();
        res.status(200).json(instructors);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching instructors', error: error.message });
    }
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});