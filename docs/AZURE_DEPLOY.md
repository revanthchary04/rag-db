# Azure Container Apps Deployment Guide

## Prerequisites

1. Azure CLI installed and logged in:

   ```bash
   az login
   ```

2. Azure Container Apps extension:
   ```bash
   az extension add --name containerapp --upgrade
   ```

## Quick Deploy Steps

### 1. Navigate to project root

```bash
cd path/to/rag-eval-observe
ls  # Should see backend/Dockerfile
```

### 2. Create resource group and container registry

Pick a region (example: `westeurope`; you can change it).

```bash
RG="rag-rg"
LOC="westeurope"
ACR="ragacr$RANDOM"

az group create -n $RG -l $LOC
az acr create -n $ACR -g $RG --sku Basic
```

### 3. Build and push image to ACR

**Important**: Our Dockerfile is in `backend/Dockerfile` and expects build context from root.

```bash
# Build in Azure and push automatically
az acr build -r $ACR -t rag-eval:1.0 -f backend/Dockerfile .
```

Your image will be:

```bash
IMAGE="$ACR.azurecr.io/rag-eval:1.0"
echo $IMAGE
```

### 4. Deploy to Azure Container Apps

**Important**: Our container listens on port `8000` (not 80).

```bash
PORT=8000

ENV="rag-env"
APP="rag-eval-app"

# Create Container Apps environment
az containerapp env create -n $ENV -g $RG -l $LOC

# Create the container app
az containerapp create \
  -n $APP -g $RG \
  --environment $ENV \
  --image "$IMAGE" \
  --target-port $PORT \
  --ingress external \
  --registry-server "$ACR.azurecr.io" \
  --query properties.configuration.ingress.fqdn
```

That prints a hostname. Open it in your browser.

### 5. Set Environment Variables

After deployment, set required environment variables:

```bash
az containerapp update \
  -n $APP -g $RG \
  --set-env-vars \
    DATABASE_URL="postgresql://user:pass@host:5432/ragdb" \
    OPENAI_API_KEY="your-api-key" \
    CORS_ALLOW_ORIGINS="https://your-frontend.vercel.app" \
    ENVIRONMENT="production"
```

Or set them during creation:

```bash
az containerapp create \
  -n $APP -g $RG \
  --environment $ENV \
  --image "$IMAGE" \
  --target-port 8000 \
  --ingress external \
  --registry-server "$ACR.azurecr.io" \
  --env-vars \
    DATABASE_URL="postgresql://user:pass@host:5432/ragdb" \
    OPENAI_API_KEY="your-api-key" \
    CORS_ALLOW_ORIGINS="https://your-frontend.vercel.app" \
    ENVIRONMENT="production" \
  --query properties.configuration.ingress.fqdn
```

## Configuration Details

### Port Configuration

- **Container Port**: `8000` (as specified in Dockerfile)
- **Target Port**: `8000` (for Azure Container Apps)
- **Host Binding**: `0.0.0.0` ✅ (already correct in Dockerfile)

### Dockerfile Verification

✅ **EXPOSE 8000** - Correct  
✅ **CMD binds to 0.0.0.0:8000** - Correct  
✅ **Build context from root** - Works with `-f backend/Dockerfile .`

## Database Setup

You'll need a PostgreSQL database with pgvector. Options:

1. **Azure Database for PostgreSQL** (managed)
2. **Containerized PostgreSQL** (separate container)
3. **External database** (any PostgreSQL with pgvector)

### Initialize Database Schema

After setting up PostgreSQL, run:

```bash
psql $DATABASE_URL < docker/init/02-create-schema.sql
```

## Testing

Once deployed, test the health endpoint:

```bash
# Get the FQDN
FQDN=$(az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv)

# Test health endpoint
curl https://$FQDN/api/v1/health
```

## Cost Optimization

For low-traffic portfolio use:

1. **Use Consumption Plan** (pay-per-use)
2. **Set min replicas to 0** (scales to zero when not in use)
3. **Use Basic ACR SKU** (cheapest option)

```bash
# Update to scale to zero
az containerapp update \
  -n $APP -g $RG \
  --min-replicas 0 \
  --max-replicas 1
```

## Troubleshooting

### Check logs

```bash
az containerapp logs show -n $APP -g $RG --follow
```

### Check status

```bash
az containerapp show -n $APP -g $RG --query properties.runningStatus
```

### Update image

```bash
az acr build -r $ACR -t rag-eval:1.1 -f backend/Dockerfile .
az containerapp update -n $APP -g $RG --image "$ACR.azurecr.io/rag-eval:1.1"
```

## Finding Your Azure Container Apps URL

### Method 1: Azure Portal - Ingress Section (Most Reliable)

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your Container App (e.g., `rag-eval-app`)
3. In the left menu, click **Ingress** (under Settings)
4. Look for **Application URL** or **FQDN**
   - It will be something like: `https://rag-eval-app.xyz123.eastus.azurecontainerapps.io`

### Method 2: Azure CLI (Easiest)

```bash
az containerapp show \
  -n rag-eval-app \
  -g rag-rg \
  --query properties.configuration.ingress.fqdn \
  -o tsv
```

This outputs the URL. Add `https://` in front of it.

## Connecting Vercel Frontend to Azure Backend

### Step 1: Configure Vercel Environment Variables

1. In your Vercel project dashboard, go to **Settings** → **Environment Variables**
2. Add: `BACKEND_API_BASE_URL` = Your Azure Container Apps URL
3. **Important:** After adding, trigger a new deployment (redeploy)

### Step 2: Update Azure CORS Settings

1. Go to Azure Portal → Your Container App → **Configuration** → **Environment variables**
2. Set `CORS_ALLOW_ORIGINS` to include your Vercel URL:
   ```
   https://your-vercel-app.vercel.app,https://your-vercel-app-git-main-username.vercel.app
   ```
3. Click **Save** (container will restart automatically)

### Step 3: Verify Connection

Test the health endpoint:
```bash
curl https://your-azure-url/api/v1/health
```

Should return: `{"ok":true,"db":true,"version":"0.1.0"}`

## Testing Backend Connection

### Test Health Endpoint

```bash
curl https://your-azure-url/api/v1/health
```

### Common Issues

- **Mixed Content Error**: Use `https://` not `http://`
- **CORS Error**: Ensure `CORS_ALLOW_ORIGINS` includes your Vercel URL
- **404 Error**: Verify the backend is running in Azure Portal

## Azure Resource Tags

Recommended tags for cost tracking and organization:

```bash
az containerapp update \
  -n rag-eval-app \
  -g rag-rg \
  --tags \
    Project=rag-eval-observability \
    Environment=production \
    Component=backend-api \
    ManagedBy=manual \
    CostCenter=portfolio
```

## Cleanup

To remove all resources:

```bash
az group delete -n $RG --yes
```
