import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { WsiReaderService } from './wsi-reader.service';
import {
  OpenSlideDto,
  SlideInfoDto,
  TileRequestDto,
  TileBatchRequestDto,
  TileInfoDto,
} from './dto/wsi-reader.dto';

@ApiTags('wsi')
@Controller('wsi')
export class WsiReaderController {
  constructor(private readonly wsiReaderService: WsiReaderService) {}

  @Get('info')
  @ApiOperation({ summary: '获取 WSI 图像信息' })
  getSlideInfo(@Query() query: OpenSlideDto): Promise<SlideInfoDto> {
    return this.wsiReaderService.getSlideInfo(query.filePath, query.level);
  }

  @Post('tile')
  @ApiOperation({ summary: '读取单个切片区域' })
  readTile(@Body() request: TileRequestDto): Promise<TileInfoDto> {
    return this.wsiReaderService.readTile(request);
  }

  @Post('tiles/batch')
  @ApiOperation({ summary: '批量滑窗读取所有切片' })
  readTilesBatch(@Body() request: TileBatchRequestDto): Promise<{
    tiles: TileInfoDto[];
    gridRows: number;
    gridCols: number;
    totalWidth: number;
    totalHeight: number;
  }> {
    return this.wsiReaderService.readTilesBatch(request);
  }

  @Post('upload')
  @ApiOperation({ summary: '上传 WSI 文件' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = join(process.cwd(), 'data', 'input');
          if (!existsSync(uploadDir)) {
            mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const uniqueName = `${Date.now()}-${file.originalname}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedExts = ['.svs', '.tif', '.tiff', '.ndpi', '.mrxs'];
        const ext = extname(file.originalname).toLowerCase();
        if (allowedExts.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error('不支持的文件格式'), false);
        }
      },
    }),
  )
  uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ): { filePath: string; originalName: string; size: number } {
    return {
      filePath: file.path,
      originalName: file.originalname,
      size: file.size,
    };
  }
}
