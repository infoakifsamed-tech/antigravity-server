import { Server } from "socket.io";

let instance: Server | null = null;

/** REST rotalarının socket odalarına erişebilmesi için Socket.io örneğini paylaşır. */
export function setIo(io: Server): void {
  instance = io;
}

export function getIo(): Server | null {
  return instance;
}

export const chatRoom = (chatId: string) => `chat:${chatId}`;
export const userRoom = (userId: string) => `user:${userId}`;
