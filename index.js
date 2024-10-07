import express, { json } from 'express';
import multer from 'multer';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const upload = multer({ dest: 'uploads/' });

// Initialize Db Connection
const db = connectDB();

// Api Request Route for registration
app.post('/registration', upload.single('file'), async (req, res) => {
    const { name, email } = req.body;
    const file = req.file;

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
                const registerNew = new RegistrationModel({
                    studentId,
                    instructorId,
                    classId,
                    startTime,
                    duration: process.env.CLASS_DURATION || 60,
                })
                await registerNew.save();
                responses.push({ row, message: 'Registration successful', registrationId: registerNew._id });
                break;

            case 'update':
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
                break;
            case 'delete':
                await RegistrationModel.deleteOne({ _id: registrationId })
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