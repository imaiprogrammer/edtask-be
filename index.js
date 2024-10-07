const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.post('/registration', upload.single('file'), (req, res) => {
    const { name, email } = req.body;
    const file = req.file;

    const filePath = path.join(__dirname, 'uploads', file.filename);
    fs.readFile(filePath, 'utf8', (err, data) => {
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