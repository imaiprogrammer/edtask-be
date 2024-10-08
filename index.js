import express, { json } from 'express';
import multer from 'multer';
import cors from 'cors';
import mongoose from 'mongoose';
import { readFile } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import connectDB from './db.js';
// Import of Registration Model Schema 
import RegistrationModel from './models/RegisterationModel.js';
import parseCSV from './utility/csvparser.js';

const app = express();
const port = 3000;

app.use(json());

app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const upload = multer({ dest: 'uploads/' });

// Initialize Db Connection
const db = connectDB();

const classDuration = process.env.CLASS_DURATION_MINUTES || 45;

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


// Api Request Route for registration
app.post('/registration', upload.single('file'), async (req, res) => {
    const { name, email } = req.body;
    const file = req.file;

    const today = new Date().setHours(0, 0, 0, 0);

    const responses = [];

    if (!file) {
        return res.status(400).send('No file uploaded');
    }

    const filePath = join(__dirname, 'uploads', file.filename);
    const parsedRows = await parseCSV(filePath);
    for (const row of parsedRows) {
        const registrationId = row['Registration ID'];
        const studentId = row['Student ID'];
        const instructorId = row['Instructor ID'];
        const classId = row['Class ID'];
        const startTime = row['Class Start Time'];
        const action = row['Action'];
        switch (action) {
            case 'new':
                // A student cannot schedule more than 'x' classes in a day (should be configurable via env variables).
                const STUDENT_MAX_CLASSES = process.env.STUDENT_MAX_CLASSES || 5;

                const studentClassCount = await RegistrationModel.countDocuments({ studentId, startTime: { $gte: today } });

                if (studentClassCount >= STUDENT_MAX_CLASSES) {
                    responses.push({ row, message: `A student cannot schedule more than ${STUDENT_MAX_CLASSES} classes in a day ` });
                    continue;
                }

                // An instructor cannot have more than 'y' classes in a day (should be configurable via env variables).
                const INSTRUCTOR_MAX_CLASSES = process.env.INSTRUCTOR_MAX_CLASSES || 5;
                const instructorClassCount = await RegistrationModel.countDocuments({ instructorId, startTime: { $gte: today } });

                if (instructorClassCount >= INSTRUCTOR_MAX_CLASSES) {
                    responses.push({ row, message: `An instructor cannot have more than ${INSTRUCTOR_MAX_CLASSES} classes in a day` });
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
                    return res.status(400).json({
                        message: `Maximum number of classes for this class type (${classId}) has been reached. Maximum allowed: ${MAX_CLASSES_PER_CLASS_TYPE}`,
                    });
                }

                //check for overlapping sessions
                const classTime = new Date(startTime);
                const isClassOverlapped = await classOverlapCheck(studentId, instructorId, classTime);
                if (isClassOverlapped) {
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
                responses.push({ row, message: 'Registration successful', registrationId: registerNew._id });
                break;

            case 'update':
                if (!mongoose.isValidObjectId(registrationId)) {
                    responses.push({ row, message: `Invalid ObjectId: ${registrationId}` });
                    continue;
                }
                try {
                    const record = await RegistrationModel.findOne({ _id: registrationId }) // Assuming that registrationId is the objectId 
                    if (record) {
                        record.studentId = studentId;
                        record.instructorId = instructorId;
                        record.classId = classId;
                        record.startTime = startTime;
                        await record.save();
                        responses.push({ row, message: 'Record updated successfully' });
                    } else {
                        responses.push({ row, message: 'Record not found' });
                    }
                } catch (error) {
                    responses.push({ row, message: `Error deleting record: ${error.message}` });
                }
                break;
            case 'delete':
                if (!mongoose.isValidObjectId(registrationId)) {
                    responses.push({ row, message: `Invalid ObjectId: ${registrationId}` });
                    continue;
                }
                try {
                    const record = await RegistrationModel.deleteOne({ _id: registrationId })
                    if (!record) {
                        responses.push({ row, message: `Record not found for ID: ${registrationId}` });
                    } else {
                        responses.push({ row, message: `Record ${record._id} deleted successfully` });
                    }
                } catch (error) {
                    responses.push({ row, message: `Error deleting record: ${error.message}` });
                }
                break;
            default:
        }
    }
    console.log('Responses...', JSON.stringify(responses));
    res.status(200).json(responses);
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});