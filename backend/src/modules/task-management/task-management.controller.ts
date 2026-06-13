import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { TaskManagementService } from './task-management.service';
import {
  CreateTaskDto,
  TaskStatus,
  TaskQueryDto,
} from './dto/task-management.dto';

@ApiTags('task')
@Controller('tasks')
export class TaskManagementController {
  constructor(private readonly taskService: TaskManagementService) {}

  @Post()
  @ApiOperation({ summary: '创建 WSI 超分拼接任务' })
  createTask(@Body() dto: CreateTaskDto): Promise<TaskStatus> {
    return this.taskService.createTask(dto);
  }

  @Get()
  @ApiOperation({ summary: '获取任务列表' })
  listTasks(@Query() query: TaskQueryDto) {
    return this.taskService.listTasks(query.state, query.offset, query.limit);
  }

  @Get(':taskId')
  @ApiOperation({ summary: '获取任务状态' })
  @ApiParam({ name: 'taskId', description: '任务 ID' })
  getTask(@Param('taskId') taskId: string): TaskStatus {
    return this.taskService.getTask(taskId);
  }

  @Delete(':taskId/cancel')
  @ApiOperation({ summary: '取消任务' })
  @ApiParam({ name: 'taskId', description: '任务 ID' })
  cancelTask(@Param('taskId') taskId: string): TaskStatus {
    return this.taskService.cancelTask(taskId);
  }
}
