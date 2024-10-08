import mongoose from 'mongoose';

const instructorSchema = new mongoose.Schema({
  instructorId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  expertise: { type: String },
});

const InstructorModel = mongoose.model('Instructor', instructorSchema);
export default InstructorModel;
