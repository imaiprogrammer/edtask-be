import express, { json } from 'express';
import multer from 'multer';
import { readFile } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import connectDB  from './db.js';
// Import of Registration Model Schema 
import RegistrationModel from './models/RegisterationModel.js';

const app = express();
const port = 3000;

app.use(json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const upload = multer({ dest: 'uploads/' });

// Initialize Db Connection
const db = connectDB();

// Api Request Route for registration
app.post('/registration', upload.single('file'), (req , res) => {
    const { name, email } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).send('No file uploaded');
    }
    
    const filePath = join(__dirname, 'uploads', file.filename);
    readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading file');
        }
        console.log('File content:', data);
        res.status(200).send('Registration successful');
    });

});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});