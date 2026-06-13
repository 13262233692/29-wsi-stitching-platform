import { Test, TestingModule } from '@nestjs/testing';
import { WsiReaderService } from '../src/modules/wsi-reader/wsi-reader.service';
import { ConfigService } from '@nestjs/config';

describe('WsiReaderService', () => {
  let service: WsiReaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsiReaderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              const map: Record<string, any> = {
                'wsi.tileSize': 512,
                'wsi.overlap': 32,
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WsiReaderService>(WsiReaderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
