import { IsString, IsInt, IsOptional, IsEnum, Min, Max, IsBoolean, IsArray, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TaskState {
  PENDING = 'pending',
  READING = 'reading',
  SUPER_RESOLVING = 'super_resolving',
  STITCHING = 'stitching',
  SAVING = 'saving',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface NucleusAnalysisStatus {
  enabled: boolean;
  totalTiles: number;
  analyzedTiles: number;
  totalNuclei: number;
  abnormalCount: number;
  milvusSaved: number;
  abnormalCells: any[];
}

export class CreateTaskDto {
  @ApiProperty({ description: 'WSI 文件路径', example: '/data/input/sample.svs' })
  @IsString()
  filePath: string;

  @ApiPropertyOptional({ description: '金字塔层级 (0 为最高分辨率)', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  pyramidLevel?: number;

  @ApiPropertyOptional({ description: '切片尺寸', example: 512 })
  @IsOptional()
  @IsInt()
  @Min(64)
  tileSize?: number;

  @ApiPropertyOptional({ description: '重叠像素数', example: 32 })
  @IsOptional()
  @IsInt()
  @Min(0)
  overlap?: number;

  @ApiPropertyOptional({ description: '超分模型名称' })
  @IsOptional()
  @IsString()
  modelName?: string;

  @ApiPropertyOptional({ description: '是否启用细胞核形态学分析 (默认 true)' })
  @IsOptional()
  @IsBoolean()
  enableNucleusAnalysis?: boolean;
}

export class TaskStatus {
  @ApiProperty({ description: '任务 ID' })
  taskId: string;

  @ApiProperty({ description: '任务状态', enum: TaskState })
  state: TaskState;

  @ApiProperty({ description: '总体进度 0-100' })
  progress: number;

  @ApiProperty({ description: '当前阶段描述' })
  message: string;

  @ApiProperty({ description: '原始文件路径' })
  filePath: string;

  @ApiProperty({ description: '原始图像宽度' })
  originalWidth?: number;

  @ApiProperty({ description: '原始图像高度' })
  originalHeight?: number;

  @ApiProperty({ description: '超分后图像宽度' })
  outputWidth?: number;

  @ApiProperty({ description: '超分后图像高度' })
  outputHeight?: number;

  @ApiProperty({ description: '输出文件路径' })
  outputPath?: string;

  @ApiProperty({ description: '缩略图 (Base64)' })
  thumbnail?: string;

  @ApiProperty({ description: '错误信息' })
  errorMessage?: string;

  @ApiProperty({ description: '创建时间' })
  createdAt: number;

  @ApiProperty({ description: '开始时间' })
  startedAt?: number;

  @ApiProperty({ description: '完成时间' })
  completedAt?: number;

  @ApiProperty({ description: '总切片数' })
  totalTiles?: number;

  @ApiProperty({ description: '已处理切片数' })
  processedTiles?: number;

  @ApiProperty({ description: '细胞核分析状态' })
  nucleusAnalysis?: NucleusAnalysisStatus;
}

export class TaskQueryDto {
  @ApiPropertyOptional({ description: '按状态筛选', enum: TaskState })
  @IsOptional()
  @IsEnum(TaskState)
  state?: TaskState;

  @ApiPropertyOptional({ description: '分页偏移', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: '分页大小', example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
