import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { join } from 'path';
import { createReadStream, existsSync } from 'fs';
import { OmeTiffService } from '../ome-tiff/ome-tiff.service';

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);

  constructor(private readonly omeTiffService: OmeTiffService) {}

  async streamTaskOutput(taskId: string): Promise<StreamableFile | null> {
    const outputPath = this.omeTiffService.getOutputPath(taskId);
    if (!existsSync(outputPath)) {
      this.logger.warn(`任务输出文件不存在: ${outputPath}`);
      return null;
    }
    const fileStream = createReadStream(outputPath);
    return new StreamableFile(fileStream, {
      type: 'image/tiff',
      disposition: `attachment; filename="${taskId}.ome.tiff"`,
    });
  }
}
