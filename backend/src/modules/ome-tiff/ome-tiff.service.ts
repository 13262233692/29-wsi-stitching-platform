import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import {
  createWriteStream,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  ReadStream,
  createReadStream,
} from 'fs';

export interface TiffPyramidLevel {
  level: number;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
}

export interface OmeTiffBuilderOptions {
  outputPath?: string;
  imageName?: string;
  tileSize?: number;
  pyramidLevels?: number;
  channels?: number;
  bitsPerSample?: number;
}

@Injectable()
export class OmeTiffService implements OnModuleInit {
  private readonly logger = new Logger(OmeTiffService.name);
  private outputDir: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.outputDir = join(process.cwd(), 'data', 'output', 'ome-tiff');
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  generateOmeXml(
    imageName: string,
    width: number,
    height: number,
    options: OmeTiffBuilderOptions = {},
  ): string {
    const channels = options.channels || 3;
    const bitsPerSample = options.bitsPerSample || 8;
    const now = new Date().toISOString();
    const pixelType = bitsPerSample === 8 ? 'uint8' : 'uint16';
    const samplesPerPixel = channels;

    const channelNames = ['Red', 'Green', 'Blue'];
    const channelsXml = Array.from({ length: channels }, (_, i) => {
      const name = channelNames[i] || `Channel-${i}`;
      return `<Channel ID="Channel:0:${i}" Name="${name}" SamplesPerPixel="1"/>`;
    }).join('\n          ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.openmicroscopy.org/Schemas/OME/2016-06 http://www.openmicroscopy.org/Schemas/OME/2016-06/ome.xsd"
     UUID="urn:uuid:${crypto.randomUUID()}">
  <Image ID="Image:0" Name="${imageName}">
    <AcquisitionDate>${now}</AcquisitionDate>
    <Pixels ID="Pixels:0" DimensionOrder="XYCZT"
            Type="${pixelType}"
            SizeX="${width}" SizeY="${height}" SizeZ="1" SizeC="${channels}" SizeT="1"
            BigEndian="false"
            Interleaved="true">
      ${channelsXml}
      <TiffData IFD="0" PlaneCount="${samplesPerPixel}"/>
    </Pixels>
  </Image>
</OME>`;
  }

  async buildStreamingHeader(
    width: number,
    height: number,
    options: OmeTiffBuilderOptions = {},
  ): Promise<Buffer> {
    const imageName = options.imageName || 'WSI-SuperRes';
    const tileSize = options.tileSize || this.configService.get('wsi.tileSize', 512);
    const omeXml = this.generateOmeXml(imageName, width, height, options);

    const header: any = {
      magic: 'OME-TIFF',
      version: '1.0',
      width,
      height,
      tileSize,
      channels: options.channels || 3,
      bitsPerSample: options.bitsPerSample || 8,
      pyramidLevels: this.computePyramidLevels(width, height, tileSize),
      omeXml,
      createdAt: Date.now(),
    };

    const headerStr = JSON.stringify(header);
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32BE(headerStr.length, 0);
    return Buffer.concat([headerLen, Buffer.from(headerStr, 'utf-8')]);
  }

  async buildTileChunk(
    row: number,
    col: number,
    imageData: string,
    level: number = 0,
  ): Promise<Buffer> {
    const tile: any = {
      type: 'tile',
      row,
      col,
      level,
      imageData,
      timestamp: Date.now(),
    };
    const tileStr = JSON.stringify(tile);
    const tileLen = Buffer.alloc(4);
    tileLen.writeUInt32BE(tileStr.length, 0);
    return Buffer.concat([tileLen, Buffer.from(tileStr, 'utf-8')]);
  }

  async buildProgressChunk(progress: number, message: string): Promise<Buffer> {
    const chunk: any = {
      type: 'progress',
      progress,
      message,
      timestamp: Date.now(),
    };
    const chunkStr = JSON.stringify(chunk);
    const chunkLen = Buffer.alloc(4);
    chunkLen.writeUInt32BE(chunkStr.length, 0);
    return Buffer.concat([chunkLen, Buffer.from(chunkStr, 'utf-8')]);
  }

  async buildFinalChunk(outputPath: string): Promise<Buffer> {
    const chunk: any = {
      type: 'final',
      outputPath,
      timestamp: Date.now(),
    };
    const chunkStr = JSON.stringify(chunk);
    const chunkLen = Buffer.alloc(4);
    chunkLen.writeUInt32BE(chunkStr.length, 0);
    return Buffer.concat([chunkLen, Buffer.from(chunkStr, 'utf-8')]);
  }

  computePyramidLevels(width: number, height: number, tileSize: number): TiffPyramidLevel[] {
    const levels: TiffPyramidLevel[] = [];
    let w = width;
    let h = height;
    let lv = 0;
    while (w >= tileSize || h >= tileSize) {
      levels.push({
        level: lv,
        width: w,
        height: h,
        tileWidth: tileSize,
        tileHeight: tileSize,
      });
      w = Math.floor(w / 2);
      h = Math.floor(h / 2);
      lv++;
    }
    if (levels.length === 0) {
      levels.push({ level: 0, width, height, tileWidth: tileSize, tileHeight: tileSize });
    }
    return levels;
  }

  getReadStream(outputPath: string): ReadStream {
    return createReadStream(outputPath);
  }

  getOutputPath(taskId: string): string {
    return join(this.outputDir, `${taskId}.ome.tiff`);
  }
}
