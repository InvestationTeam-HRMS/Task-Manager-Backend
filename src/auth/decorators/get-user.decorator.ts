import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetTeam = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const identity = request.user; // NestJS usually attaches to request.user by default

    return data ? identity?.[data] : identity;
  },
);

export const GetUser = GetTeam;
