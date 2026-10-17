import { Request, Response, NextFunction, RequestHandler } from "express";

/** Express 4'te async handler hatalarını errorHandler'a iletir. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
