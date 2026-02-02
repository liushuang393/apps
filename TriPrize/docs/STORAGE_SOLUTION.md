# 图片存储方案说明

## 当前方案：本地文件存储

### 概述
TriPrize 项目使用**本地文件系统**存储图片，不依赖云存储服务（如 AWS S3）。

---

## 为什么不使用 AWS S3？

### 1. **成本考虑**
- AWS S3 需要付费
- 对于小型项目，本地存储更经济

### 2. **简化部署**
- 不需要创建 AWS 账户
- 不需要配置 IAM 用户和权限
- 减少外部依赖

### 3. **开发便利性**
- 本地开发时直接访问文件
- 不需要网络连接到云服务
- 调试更简单

---

## 存储架构

### 开发环境
```
TriPrize/
├── api/
│   └── uploads/          # 上传的图片存储在这里
│       ├── campaigns/    # 活动图片
│       ├── prizes/       # 奖品图片
│       └── temp/         # 临时文件
```

### Docker 环境
```yaml
# docker-compose.yml
services:
  api:
    volumes:
      - ./api/uploads:/app/uploads  # 映射到宿主机
      - ./api/logs:/app/logs
```

图片存储在 Docker 卷中，映射到宿主机的 `api/uploads` 目录。

### 生产环境
有两种选择：

#### 选项 1: 使用 Docker 卷（推荐）
```yaml
services:
  api:
    volumes:
      - uploads_data:/app/uploads  # 使用命名卷

volumes:
  uploads_data:
    driver: local
```

#### 选项 2: 使用云存储（可选）
如果需要更高的可用性和扩展性，可以配置 AWS S3：
1. 创建 S3 Bucket
2. 配置 IAM 用户
3. 设置环境变量
4. 修改上传逻辑使用 S3

---

## 访问图片

### API 端点
```
GET /api/uploads/campaigns/:filename
GET /api/uploads/prizes/:filename
```

### 示例
```bash
# 获取活动图片
curl http://localhost:3000/api/uploads/campaigns/campaign-123.jpg

# 获取奖品图片
curl http://localhost:3000/api/uploads/prizes/prize-456.jpg
```

---

## 备份策略

### 开发环境
- 图片存储在 `api/uploads/` 目录
- 可以手动备份或使用 Git LFS（大文件存储）

### 生产环境
建议的备份方案：

1. **定期备份 Docker 卷**
   ```bash
   # 备份卷
   docker run --rm -v triprize_uploads_data:/data -v $(pwd):/backup \
     alpine tar czf /backup/uploads-backup-$(date +%Y%m%d).tar.gz /data
   
   # 恢复卷
   docker run --rm -v triprize_uploads_data:/data -v $(pwd):/backup \
     alpine tar xzf /backup/uploads-backup-20250121.tar.gz -C /
   ```

2. **使用 rsync 同步到备份服务器**
   ```bash
   rsync -avz ./api/uploads/ backup-server:/backups/triprize/uploads/
   ```

3. **云备份（可选）**
   - 使用 rclone 同步到云存储
   - 配置自动备份脚本

---

## 性能优化

### 1. 图片压缩
上传时自动压缩图片：
```typescript
// 使用 sharp 库压缩图片
import sharp from 'sharp';

await sharp(inputPath)
  .resize(1200, 1200, { fit: 'inside' })
  .jpeg({ quality: 80 })
  .toFile(outputPath);
```

### 2. CDN（可选）
如果需要更快的访问速度，可以在前面加一层 CDN：
- Cloudflare
- Fastly
- AWS CloudFront

### 3. 缓存
配置 Nginx 或 API 服务器缓存静态文件：
```nginx
location /api/uploads/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

---

## 迁移到云存储（可选）

如果将来需要迁移到 AWS S3，步骤如下：

1. **创建 S3 Bucket**
2. **配置环境变量**（参见 `ENVIRONMENT_SETUP.md`）
3. **修改上传逻辑**
4. **迁移现有文件**
   ```bash
   aws s3 sync ./api/uploads/ s3://your-bucket-name/
   ```

---

## 总结

✅ **优点**:
- 零成本
- 简单易用
- 快速部署
- 完全控制

❌ **缺点**:
- 需要自己管理备份
- 扩展性有限（单服务器）
- 没有 CDN 加速

对于 TriPrize 项目的规模，**本地文件存储是最合适的方案**。

