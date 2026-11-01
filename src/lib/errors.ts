// An error with a message that is safe to show to clients and Lara
export class BookingError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
