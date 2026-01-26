import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RoleService {
    constructor(private prisma: PrismaService) { }

    async create(dto: CreateRoleDto) {
        const { name, description, accessRight, permissions } = dto as any;

        const existing = await this.prisma.role.findUnique({
            where: { name }
        });
        if (existing) throw new ConflictException('Role already exists');

        return this.prisma.role.create({
            data: {
                name,
                description,
                permissions: accessRight || permissions || {}
            }
        });
    }

    async findAll() {
        const roles = await this.prisma.role.findMany();

        const rolesSortPriority: Record<string, number> = {
            'Super Admin': 1,
            'Admin': 2,
            'HR Manager': 3,
            'Hr Manager': 3,
            'HR': 4,
            'Recruiter': 5,
            'Project Head': 6,
            'Supervisor': 7,
            'Support': 8,
            'Auditor': 9,
            'Staff / Employee': 10,
            'User': 11,
            'Guest': 12
        };

        const sortedRoles = roles.sort((a, b) => {
            const priorityA = rolesSortPriority[a.name] || 100;
            const priorityB = rolesSortPriority[b.name] || 100;

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            return a.name.localeCompare(b.name);
        });

        return sortedRoles.map(role => ({
            ...role,
            users: [], // TODO: Link with Team/User if needed
            accessRight: (role.permissions as any) || {}
        }));
    }

    async findOne(id: string) {
        const role = await this.prisma.role.findUnique({ where: { id } });
        if (!role) throw new NotFoundException('Role not found');
        return {
            ...role,
            users: [],
            accessRight: (role.permissions as any) || {}
        };
    }

    async update(id: string, dto: UpdateRoleDto) {
        await this.findOne(id);
        const { name, description, accessRight, permissions } = dto as any;

        return this.prisma.role.update({
            where: { id },
            data: {
                name,
                description,
                permissions: accessRight || permissions
            }
        });
    }

    async remove(id: string) {
        await this.findOne(id);
        return this.prisma.role.delete({ where: { id } });
    }
}
