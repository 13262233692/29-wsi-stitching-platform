<template>
  <div class="create-task-dialog">
    <el-dialog
      v-model="visible"
      title="创建 WSI 超分拼接任务"
      width="520px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="WSI 文件" prop="file">
          <el-upload
            drag
            :auto-upload="false"
            :show-file-list="true"
            :limit="1"
            accept=".svs,.tif,.tiff,.ndpi,.mrxs"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
          >
            <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              将文件拖到此处，或<em>点击上传</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">支持 .svs / .tif / .tiff / .ndpi / .mrxs 格式</div>
            </template>
          </el-upload>
          <div v-if="uploadProgress > 0 && uploadProgress < 100" class="upload-progress">
            <el-progress :percentage="uploadProgress" />
          </div>
        </el-form-item>
        <el-form-item label="文件路径" prop="filePath">
          <el-input
            v-model="form.filePath"
            placeholder="或直接输入服务器文件路径"
          />
        </el-form-item>
        <el-form-item label="金字塔层级" prop="pyramidLevel">
          <el-input-number v-model="form.pyramidLevel" :min="0" :max="10" />
          <span class="tip-text ml-2">0 为最高分辨率</span>
        </el-form-item>
        <el-form-item label="切片尺寸" prop="tileSize">
          <el-input-number v-model="form.tileSize" :min="64" :max="2048" :step="64" />
          <span class="tip-text ml-2">像素</span>
        </el-form-item>
        <el-form-item label="重叠像素" prop="overlap">
          <el-input-number v-model="form.overlap" :min="0" :max="256" />
          <span class="tip-text ml-2">高斯混合重叠区</span>
        </el-form-item>
        <el-form-item label="超分模型" prop="modelName">
          <el-input v-model="form.modelName" placeholder="wsi_super_resolution" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          开始处理
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import type { FormInstance, FormRules, UploadFile } from 'element-plus';
import { ElMessage } from 'element-plus';
import { createTask, uploadWsiFile } from '@/api';
import type { CreateTaskRequest, TaskStatus } from '@/types';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'created', task: TaskStatus): void;
}>();

const visible = ref(props.modelValue);
watch(
  () => props.modelValue,
  (v) => (visible.value = v),
);
watch(visible, (v) => emit('update:modelValue', v));

const formRef = ref<FormInstance>();
const submitting = ref(false);
const uploadProgress = ref(0);
const currentFile = ref<File | null>(null);

const form = reactive<CreateTaskRequest & { file?: File }>({
  filePath: '',
  pyramidLevel: 0,
  tileSize: 512,
  overlap: 32,
  modelName: 'wsi_super_resolution',
});

const rules: FormRules = {
  filePath: [
    {
      validator: (_r, _v, cb) => {
        if (form.filePath || currentFile.value) {
          cb();
        } else {
          cb(new Error('请上传文件或输入文件路径'));
        }
      },
      trigger: 'change',
    },
  ],
};

function handleFileChange(file: UploadFile) {
  currentFile.value = file.raw || null;
}
function handleFileRemove() {
  currentFile.value = null;
}

async function handleSubmit() {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }

  submitting.value = true;
  try {
    let filePath = form.filePath;
    if (currentFile.value) {
      uploadProgress.value = 0;
      const result = await uploadWsiFile(currentFile.value, (p) => {
        uploadProgress.value = p;
      });
      filePath = result.filePath;
    }

    const payload: CreateTaskRequest = {
      filePath,
      pyramidLevel: form.pyramidLevel,
      tileSize: form.tileSize,
      overlap: form.overlap,
      modelName: form.modelName,
    };
    const task = await createTask(payload);
    ElMessage.success(`任务已创建: ${task.taskId}`);
    emit('created', task);
    visible.value = false;
    reset();
  } catch (err: any) {
    ElMessage.error(err.message || '创建任务失败');
  } finally {
    submitting.value = false;
    uploadProgress.value = 0;
  }
}

function reset() {
  form.filePath = '';
  form.pyramidLevel = 0;
  form.tileSize = 512;
  form.overlap = 32;
  form.modelName = 'wsi_super_resolution';
  currentFile.value = null;
}
</script>

<style scoped lang="scss">
.tip-text {
  color: #8b9cb5;
  font-size: 12px;
}
.ml-2 { margin-left: 8px; }
.upload-progress {
  margin-top: 8px;
}
</style>
