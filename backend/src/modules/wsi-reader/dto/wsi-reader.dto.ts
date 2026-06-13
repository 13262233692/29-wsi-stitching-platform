import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OpenSlideDto {
  @ApiProperty({ description: 'WSI 文件路径', example: '/data/input/sample.svs' })
  @IsString()
  filePath: string;

  @ApiPropertyOptional({ description: '金字塔层级 (0 为最高分辨率)', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  level?: number;
}

export class SlideInfoDto {
  @ApiProperty({ description: '文件路径' })
  filePath: string;

  @ApiProperty({ description: '金字塔层数' })
  levelCount: number;

  @ApiProperty({ description: '每层尺寸信息' })
  levels: Array<{
    level: number;
    width: number;
    height: number;
    downsample: number;
  }>;

  @ApiProperty({ description: '元数据信息' })
  metadata: Record<string, string>;
}

export class TileRequestDto extends OpenSlideDto {
  @ApiProperty({ description: '左上角 X 坐标', example: 0 })
  @IsInt()
  @Min(0)
  x: number;

  @ApiProperty({ description: '左上角 Y 坐标', example: 0 })
  @IsInt()
  @Min(0)
  y: number;

  @ApiProperty({ description: '裁剪宽度', example: 512 })
  @IsInt()
  @Min(1)
  width: number;

  @ApiProperty({ description: '裁剪高度', example: 512 })
  @IsInt()
  @Min(1)
  height: number;
}

export class TileBatchRequestDto extends OpenSlideDto {
  @ApiProperty({ description: '切片尺寸', example: 512 })
  @IsInt()
  @Min(64)
  tileSize: number;

  @ApiProperty({ description: '重叠像素数', example: 32 })
  @IsInt()
  @Min(0)
  overlap: number;
}

export class TileInfoDto {
  @ApiProperty({ description: '切片索引 (行)' })
  row: number;

  @ApiProperty({ description: '切片索引 (列)' })
  col: number;

  @ApiProperty({ description: '原始图像 X 坐标' })
  x: number;

  @ApiProperty({ description: '原始图像 Y 坐标' })
  y: number;

  @ApiProperty({ description: '切片宽度' })
  width: number;

  @ApiProperty({ description: '切片高度' })
  height: number;

  @ApiProperty({ description: 'Base64 编码的图像数据' })
  imageData: string;
}
