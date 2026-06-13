import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TritonClientService } from './triton-client.service';
import {
  SuperResolutionRequestDto,
  SuperResolutionResponseDto,
  BatchSuperResolutionDto,
} from './dto/triton-client.dto';

@ApiTags('triton')
@Controller('triton')
export class TritonClientController {
  constructor(private readonly tritonClientService: TritonClientService) {}

  @Get('status')
  @ApiOperation({ summary: '检查 Triton 推理服务状态' })
  getStatus(): Promise<{ serverLive: boolean; modelReady: boolean }> {
    return this.tritonClientService.checkServerStatus();
  }

  @Post('super-resolve')
  @ApiOperation({ summary: '单张图像超分辨率重构' })
  superResolve(
    @Body() request: SuperResolutionRequestDto,
  ): Promise<SuperResolutionResponseDto> {
    return this.tritonClientService.superResolve(request);
  }

  @Post('super-resolve/batch')
  @ApiOperation({ summary: '批量切片超分辨率重构' })
  superResolveBatch(@Body() request: BatchSuperResolutionDto) {
    return this.tritonClientService.superResolveBatch(request);
  }
}
