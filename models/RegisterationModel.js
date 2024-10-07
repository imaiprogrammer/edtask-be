import mongoose from 'mongoose';

const registrationSchema = new mongoose.Schema({
    studentId: String,
    instructorId: String,
    classId: String,
    startTime: Date,
    duration: Number,
}, { timestamps: true });

const RegistrationModel = mongoose.model('Registration', registrationSchema);

export default RegistrationModel;