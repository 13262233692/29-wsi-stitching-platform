import { IsString, IsInt, IsOptional, IsArray, IsNumber, IsBoolean, Min, Max, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyzeTileRequestDto {
  @ApiProperty({ description: '任务 ID' })
  @IsString()
  taskId: string;

  @ApiProperty({ description: 'tile 行号' })
  @IsInt()
  tileRow: number;

  @ApiProperty({ description: 'tile 列号' })
  @IsInt()
  tileCol: number;

  @ApiProperty({ description: 'tile 在全局 WSI 中的坐标偏移 [x, y]' })
  @IsArray()
  @ArrayNotEmpty()
  tileGlobalOffset: number[];

  @ApiProperty({ description: 'WSI 图像原始宽度' })
  @IsInt()
  wsiWidth: number;

  @ApiProperty({ description: 'WSI 图像原始高度' })
  @IsInt()
  wsiHeight: number;

  @ApiProperty({ description: 'tile PNG base64' })
  @IsString()
  imageB64: string;

  @ApiPropertyOptional({ minimum: 10, maximum: 100000, default: 80 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100000)
  minArea?: number;

  @ApiPropertyOptional({ default: 8000 })
  @IsOptional()
  @IsInt()
  maxArea?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  scoreThreshold?: number;

  @ApiPropertyOptional({ default: false, description: '是否跳过 Milvus 持久化 (调试用)' })
  @IsOptional()
  @IsBoolean()
  skipMilvus?: boolean;
}

export class NucleiQueryRequestDto {
  @ApiProperty({ description: '任务 ID' })
  @IsString()
  taskId: string;

  @ApiPropertyOptional({ default: 5000 })
  @IsOptional()
  @IsInt()
  topK?: number;
}

export class NucleiSearchRequestDto {
  @ApiProperty({ description: '12-D 特征向量' })
  @IsArray()
  @ArrayNotEmpty()
  featureVector: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  topK?: number;
}
