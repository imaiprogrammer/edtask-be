import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
    studentId: { type: String, required: true, unique: true},
    name: { type: String, required: true},
    email: { type: String, required: true},
    phone: { type: String, required: false},
})

const StudentModel = mongoose.model('Student', studentSchema);
export default StudentModel;