import { IsString, IsInt, IsOptional, IsArray, Min, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuperResolutionRequestDto {
  @ApiProperty({ description: 'Base64 编码的输入图像' })
  @IsString()
  imageData: string;

  @ApiPropertyOptional({ description: '模型名称', example: 'wsi_super_resolution' })
  @IsOptional()
  @IsString()
  modelName?: string;

  @ApiPropertyOptional({ description: '超分放大倍数', example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  scaleFactor?: number;
}

export class SuperResolutionResponseDto {
  @ApiProperty({ description: 'Base64 编码的超分后图像' })
  imageData: string;

  @ApiProperty({ description: '超分后图像宽度' })
  width: number;

  @ApiProperty({ description: '超分后图像高度' })
  height: number;

  @ApiProperty({ description: '放大倍数' })
  scaleFactor: number;
}

export class BatchSuperResolutionDto {
  @ApiProperty({ description: '切片列表', type: 'array', items: { type: 'object' } })
  @IsArray()
  tiles: Array<{
    row: number;
    col: number;
    x: number;
    y: number;
    width: number;
    height: number;
    imageData: string;
  }>;
}
