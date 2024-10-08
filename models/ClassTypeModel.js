import mongoose from 'mongoose';

const classTypeSchema = new mongoose.Schema({
  classId: { type: String, required: true, unique: true },
  className: { type: String, required: true },
  description: { type: String },
});

const ClassType = mongoose.model('ClassType', classTypeSchema);
export default ClassType;
