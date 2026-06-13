import { Controller, Get, Param, Res, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { StreamingService } from './streaming.service';

@ApiTags('streaming')
@Controller('streaming')
export class StreamingController {
  constructor(private readonly streamingService: StreamingService) {}

  @Get(':taskId/download')
  @ApiOperation({ summary: '下载指定任务的 OME-TIFF 输出文件' })
  @ApiParam({ name: 'taskId', description: '任务 ID' })
  async downloadResult(@Param('taskId') taskId: string, @Res() res: Response) {
    const stream = await this.streamingService.streamTaskOutput(taskId);
    if (!stream) {
      throw new NotFoundException(`任务输出文件不存在: ${taskId}`);
    }
    return stream.getStream().pipe(res);
  }
}
