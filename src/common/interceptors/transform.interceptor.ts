import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/api-response.dto';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
    intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
        const request = context.switchToHttp().getRequest();

        return next.handle().pipe(
            map((data) => {
                // If data is already an ApiResponse, return it
                if (data instanceof ApiResponse) {
                    data.path = request.url;
                    return data;
                }

                // Otherwise wrap it
                const response = ApiResponse.success('Success', data);
                response.path = request.url;
                return response;
            }),
        );
    }
}
