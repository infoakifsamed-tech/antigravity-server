import mongoose from "mongoose";
import { env } from "../config/env";

export async function connectMongo(): Promise<void> {
  mongoose.connection.on("error", (err) => console.error("[mongo] hata:", err));
  mongoose.connection.on("disconnected", () => console.warn("[mongo] bağlantı koptu"));
  await mongoose.connect(env.MONGO_URL, { serverSelectionTimeoutMS: 5000 });
}

export const mongoReady = () => mongoose.connection.readyState === 1;
