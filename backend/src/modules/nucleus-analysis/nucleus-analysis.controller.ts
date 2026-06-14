import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Delete,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NucleusAnalysisService } from './nucleus-analysis.service';
import {
  AnalyzeTileRequestDto,
  NucleiQueryRequestDto,
  NucleiSearchRequestDto,
} from './dto/nucleus-analysis.dto';

@ApiTags('nucleus-analysis')
@Controller('nucleus-analysis')
export class NucleusAnalysisController {
  constructor(private readonly service: NucleusAnalysisService) {}

  @Post('analyze-tile')
  @ApiOperation({ summary: '对单张 HR tile 执行: 分割 -> 特征提取 -> 异常判定 -> Milvus 入库' })
  @HttpCode(200)
  analyzeTile(@Body() dto: AnalyzeTileRequestDto) {
    return this.service.analyzeTile(dto);
  }

  @Get('query-task')
  @ApiOperation({ summary: '查询指定 WSI 任务下所有已入库的异常细胞核' })
  queryTask(@Query() dto: NucleiQueryRequestDto) {
    return this.service.queryTask(dto.taskId, dto.topK ?? 5000);
  }

  @Post('search-similar')
  @ApiOperation({ summary: 'Milvus 12-D 形态学特征向量相似度检索' })
  @HttpCode(200)
  searchSimilar(@Body() dto: NucleiSearchRequestDto) {
    return this.service.searchSimilar(dto);
  }

  @Delete('task/:taskId')
  @ApiOperation({ summary: '删除指定任务下所有 Milvus 记录' })
  deleteTask(taskId: string) {
    return this.service.deleteTask(taskId);
  }

  @Get('health')
  @ApiOperation({ summary: 'Milvus / 分析算子健康检查' })
  health() {
    return this.service.healthCheck();
  }
}
