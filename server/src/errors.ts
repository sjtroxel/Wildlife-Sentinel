export class AppError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(msg = 'Not found') { super(404, msg); }
}

export class ValidationError extends AppError {
  constructor(msg: string) { super(400, msg); }
}

export class DatabaseError extends AppError {
  constructor(msg: string) { super(500, msg); }
}

export class ExternalAPIError extends AppError {
  constructor(public readonly apiName: string, msg: string) {
    super(502, `${apiName}: ${msg}`);
  }
}
