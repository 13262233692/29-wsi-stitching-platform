import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Query,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MilvusService } from '../milvus/milvus.service';
import { CellAnalysisService } from './cell-analysis.service';

@ApiTags('cell-analysis')
@Controller('cell-analysis')
export class CellAnalysisController {
  private readonly logger = new Logger(CellAnalysisController.name);

  constructor(
    private readonly cellAnalysis: CellAnalysisService,
    private readonly milvus: MilvusService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: '细胞分析模块状态 (含 Milvus 连接)' })
  status() {
    return {
      milvus: this.milvus.getStats(),
      workerPool: (this.cellAnalysis as any).workerPool?.stats?.() || null,
    };
  }

  @Get('tasks/:taskId/abnormal')
  @ApiOperation({ summary: '查询某个 WSI 任务的异常细胞列表' })
  async listAbnormal(
    @Param('taskId') taskId: string,
    @Query('limit') limit = 500,
  ) {
    const items = await this.milvus.listAbnormalByTask(taskId, limit);
    return { total: items.length, items };
  }

  @Post('tasks/:taskId/search-similar')
  @ApiOperation({ summary: '向量相似度检索: 找形态相似的异常细胞' })
  async searchSimilar(
    @Param('taskId') taskId: string,
    @Body() body: { vector: number[]; topK?: number; global?: boolean },
  ) {
    const result = await this.milvus.searchByVector(body.vector, {
      topK: body.topK || 20,
      taskId: body.global ? undefined : taskId,
      onlyAbnormal: true,
    });
    return { results: result };
  }

  @Post('analyze')
  @ApiOperation({ summary: '[调试] 对单张 tile base64 执行细胞分析' })
  async analyzeOne(
    @Body()
    body: {
      imageData: string;
      tileRow?: number;
      tileCol?: number;
      tileSize?: number;
      overlap?: number;
      scaleFactor?: number;
    },
  ) {
    return this.cellAnalysis.analyzeSingleTile({
      taskId: 'debug-' + Date.now(),
      slidePath: 'debug',
      tileRow: body.tileRow || 0,
      tileCol: body.tileCol || 0,
      tileSize: body.tileSize || 512,
      overlap: body.overlap || 32,
      scaleFactor: body.scaleFactor || 4,
      imageData: body.imageData,
    });
  }
}
