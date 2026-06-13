import { registerAs } from '@nestjs/config';

export default registerAs('wsi', () => ({
  tileSize: parseInt(process.env.WSI_TILE_SIZE || '512', 10),
  overlap: parseInt(process.env.WSI_OVERLAP || '32', 10),
  inputDir: process.env.WSI_INPUT_DIR || './data/input',
  outputDir: process.env.WSI_OUTPUT_DIR || './data/output',
  pyramidLevel: parseInt(process.env.WSI_PYRAMID_LEVEL || '0', 10),
  supportedFormats: process.env.WSI_SUPPORTED_FORMATS
    ? process.env.WSI_SUPPORTED_FORMATS.split(',')
    : ['.svs', '.tif', '.tiff', '.ndpi', '.mrxs'],
}));
