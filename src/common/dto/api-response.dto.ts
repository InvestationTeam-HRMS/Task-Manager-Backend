export class ApiResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: any;
    timestamp: string;
    path?: string;

    constructor(success: boolean, message: string, data?: T, error?: any) {
        this.success = success;
        this.message = message;
        this.data = data;
        this.error = error;
        this.timestamp = new Date().toISOString();
    }

    static success<T>(message: string, data?: T): ApiResponse<T> {
        return new ApiResponse(true, message, data);
    }

    static error(message: string, error?: any): ApiResponse {
        return new ApiResponse(false, message, undefined, error);
    }
}

export class PaginatedResponse<T> {
    data: T[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };

    constructor(data: T[], total: number, page: number, limit: number) {
        this.data = data;
        this.meta = {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page < Math.ceil(total / limit),
            hasPreviousPage: page > 1,
        };
    }
}
