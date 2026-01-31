import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiResponse } from '../dto/api-response.dto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';
        let error: any = null;

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();

            if (typeof exceptionResponse === 'string') {
                message = exceptionResponse;
            } else if (typeof exceptionResponse === 'object') {
                message = (exceptionResponse as any).message || message;
                error = (exceptionResponse as any).error;
            }
        } else if (exception instanceof Error) {
            // Log full error for internal tracking
            this.logger.error(`[INTERNAL_ERROR] ${exception.message}`, exception.stack);

            // Hide internal technical details from the user
            if (exception.constructor.name.includes('Prisma')) {
                message = 'A database error occurred. Please try again later.';
            } else {
                message = 'A system error occurred. Our team has been notified.';
            }
        }

        this.logger.error(
            `${request.method} ${request.url} - Status: ${status} - Message: ${message}`,
        );

        const apiResponse = ApiResponse.error(message, error);
        apiResponse.path = request.url;

        response.status(status).json(apiResponse);
    }
}
