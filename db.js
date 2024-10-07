import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const dbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/class-schedules';

const connectDB = async () => {
    try {
      await mongoose.connect(dbUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('Connected to Db');
    } catch (err) {
      console.error('Error connecting to Db:', err);
      process.exit(1); // Exit process if the connection fails
    }
  };

export default connectDB;
