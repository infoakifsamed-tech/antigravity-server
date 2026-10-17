import { InferSchemaType, Schema, model } from "mongoose";

const reactionSchema = new Schema(
  { user_id: { type: String, required: true }, emoji: { type: String, required: true } },
  { _id: false }
);

const messageSchema = new Schema(
  {
    chat_id: { type: String, required: true, index: true },
    sender_id: { type: String, required: true },
    message_body: { type: String, default: "" },
    is_encrypted: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now },

    // Gelecek özellikler için esnek alanlar
    client_id: { type: String }, // çevrimdışı senkronizasyonda tekrarı önlemek için
    reply_to: { type: String, default: null },
    thread_root: { type: String, default: null },
    reactions: { type: [reactionSchema], default: [] },
    read_by: { type: [String], default: [] },
    edited_at: { type: Date, default: null },
    deleted_for_all: { type: Boolean, default: false },
    deleted_for: { type: [String], default: [] },
    silent: { type: Boolean, default: false },
    scheduled_for: { type: Date, default: null },
    expires_at: { type: Date, default: null }, // kaybolan mesajlar
    attachments: {
      type: [{ key: String, name: String, mime: String, size: Number, _id: false }],
      default: [],
    },
  },
  { versionKey: false }
);

messageSchema.index({ chat_id: 1, timestamp: -1 });
messageSchema.index({ chat_id: 1, client_id: 1 }, { unique: true, sparse: true });
// expires_at geldiğinde MongoDB belgeyi otomatik siler (TTL)
messageSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export type MessageDoc = InferSchemaType<typeof messageSchema>;
export const Message = model("Message", messageSchema);
