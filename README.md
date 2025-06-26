# Aegis - Intelligent Vehicle Access Management System

Aegis is a comprehensive vehicle access management system that combines AI-powered license plate recognition with role-based access control and real-time alerts. The system features a modern React frontend with neumorphic UI design and supports both IP cameras and mobile phone cameras for license plate detection.

## 🏗️ Architecture

The system consists of three main components:

- **Frontend** (`frontend/`): React application with TypeScript, Chakra UI, and neumorphic design
- **API Server** (`backend/api_server/`): FastAPI service for user management, authentication, and WebSocket alerts
- **Vision Service** (`backend/vision_service/`): AI-powered license plate recognition using YOLOv8 and OCR

## 🚀 Features

### Core Features
- **Modern Web Interface**: React frontend with responsive neumorphic design
- **Role-based Access Control**: Admin, Guard, and User roles with different dashboards
- **Real-time Alerts**: WebSocket-based live notifications for license plate detections
- **AI License Plate Recognition**: YOLOv8 + OCR-based detection with confidence scoring
- **Live Camera Feeds**: Support for IP cameras and mobile phone cameras
- **Comprehensive Dashboards**: Analytics, charts, and real-time monitoring
- **Quick Actions**: Manual scan, emergency protocols, report generation, and system overrides

### Security Features
- JWT-based authentication
- Password hashing with bcrypt
- Role-based authorization
- Secure API endpoints
- WebSocket authentication

## 📋 Prerequisites

### System Requirements
- **Node.js 16+** (for frontend)
- **Python 3.8+** (for backend services)
- **MySQL 8.0+** (for database)
- **Git**

### Mobile Requirements (for phone camera setup)
- **Android or iPhone** with IP Camera Lite app
- **Same WiFi network** as your computer

## 🛠️ Complete Installation & Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd Aegis
```

### 2. Database Setup

#### Create MySQL Database
```sql
CREATE DATABASE aegis_db;
CREATE USER 'aegis_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON aegis_db.* TO 'aegis_user'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Backend Setup

#### Create Virtual Environment
```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\Activate.ps1

# macOS/Linux
source venv/bin/activate
```

#### API Server Setup
```bash
cd api_server
pip install -r requirements.txt
pip install python-multipart pymysql

# Copy and configure environment
cp env.example .env
```

Edit `.env` file:
```env
# Database Configuration
DATABASE_URL=mysql+pymysql://aegis_user:your_password@localhost/aegis_db

# JWT Settings
SECRET_KEY=your_super_secret_key_32_chars_long
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

#### Vision Service Setup
```bash
cd ../vision_service
pip install -r requirements.txt
pip install uvicorn fastapi opencv-python ultralytics pytesseract torch torchvision

# Copy and configure environment
cp env.example .env
```

Edit `.env` file:
```env
# API Server Configuration
API_SERVER_URL=http://localhost:8000

# Vision Processing Settings
CONFIDENCE_THRESHOLD=0.7
PLATE_DETECTION_INTERVAL=5
```

### 4. Frontend Setup

#### Install Dependencies
```bash
cd ../../frontend
npm install
npm install react-icons recharts
```

#### Configure Environment
Create `.env` file:
```env
VITE_API_URL=http://localhost:8000
```

## 🚀 Running the Application

### 1. Start the API Server
```bash
cd backend/api_server
..\venv\Scripts\Activate.ps1  # Windows
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 2. Start the Vision Service
```bash
cd ../vision_service
..\venv\Scripts\Activate.ps1  # Windows
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

### 3. Start the Frontend
```bash
cd ../../frontend
npm run dev
```

### 4. Access the Application
- **Frontend**: http://localhost:5173
- **API Documentation**: http://localhost:8000/docs
- **Vision Service**: http://localhost:8001/docs

## 📱 Phone Camera Setup (IP Camera Lite)

### 1. Install IP Camera Lite

#### Android:
1. Open Google Play Store
2. Search for "IP Camera Lite" by "DroidCam"
3. Install the app

#### iPhone:
1. Open App Store
2. Search for "IP Camera Lite" or "DroidCam"
3. Install the app

### 2. Configure IP Camera Lite

#### Basic Setup:
1. **Open the app** on your phone
2. **Grant permissions** for camera and microphone
3. **Choose camera** (back camera for license plate scanning)
4. **Set quality** to "High" or "Medium"
5. **Set port** to `8081` (or note the port shown)
6. **Enable motion detection** (optional)

#### Get Your Camera URL:
1. Look for the **"URL"** or **"Stream URL"** in the app
2. It will look like: `http://192.168.1.100:8081/video`
3. **Note your phone's IP address** (e.g., `192.168.1.100`)

### 3. Connect Phone Camera to System

#### Get Your Phone's IP Address:
- **Android**: Settings → About Phone → Status → IP Address
- **iPhone**: Settings → WiFi → Tap your network → IP Address

#### Test Camera Feed:
1. Open your browser on your computer
2. Go to: `http://YOUR_PHONE_IP:8081/video`
3. You should see your phone's camera feed

#### Connect to Vision Service:
```powershell
# Windows PowerShell
Invoke-RestMethod -Uri "http://localhost:8001/streams/start" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"stream_url": "http://YOUR_PHONE_IP:8081/video"}'

# Example with actual IP
Invoke-RestMethod -Uri "http://localhost:8001/streams/start" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"stream_url": "http://192.168.1.100:8081/video"}'
```

### 4. Update Frontend Camera URL

The Guard Dashboard will automatically show your phone camera feed. If you need to update the URL manually, edit `frontend/src/pages/GuardDashboard.tsx`:

```typescript
const [liveFeeds, setLiveFeeds] = useState([
  {
    id: 1,
    name: 'Phone Camera (Main Gate)',
    url: 'http://YOUR_PHONE_IP:8081/video', // Update this
    status: 'active',
    lastDetection: null as string | null,
    detectionCount: 0
  },
  // ... other cameras
]);
```

## 👥 User Management

### Demo Users (Auto-created)
The system includes demo users for testing:

| Email | Password | Role | Access |
|-------|----------|------|--------|
| `admin@aegis.com` | `admin123` | Admin | Full system access |
| `guard@aegis.com` | `guard123` | Guard | Guard dashboard, alerts |
| `user@aegis.com` | `user123` | User | User portal, vehicle info |

### Create Custom Users
```bash
# Register new user (Admin only)
curl -X POST "http://localhost:8000/api/v1/auth/register" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "New User",
    "email": "user@example.com",
    "password": "password123",
    "role": "guard"
  }'
```

## 🎯 System Usage

### 1. Login and Access
1. **Open**: http://localhost:5173
2. **Login** with demo credentials
3. **Access role-specific dashboard**

### 2. Guard Dashboard Features
- **Live Camera Feeds**: View phone camera and IP camera streams
- **Real-time Alerts**: License plate detection notifications
- **Quick Actions**:
  - **Manual Scan**: Manually input license plates
  - **Emergency Protocol**: Activate emergency procedures
  - **Generate Report**: Create shift/incident reports
  - **Guard Settings**: Configure camera sensitivity, alerts
  - **System Override**: Override automated decisions
  - **Refresh Systems**: Restart connections

### 3. Admin Dashboard Features
- **User Management**: Add, edit, delete users
- **Vehicle Management**: Register and manage vehicles
- **System Analytics**: Charts and statistics
- **Access Logs**: Complete audit trail
- **Security Settings**: Configure system parameters
- **System Reports**: Generate comprehensive reports

### 4. User Portal Features
- **Vehicle Information**: View registered vehicles
- **Access History**: Check entry/exit logs
- **Profile Management**: Update personal information

## 🔧 API Endpoints

### Authentication
```bash
# Login
POST /api/v1/auth/token

# Register (Admin only)
POST /api/v1/auth/register

# Password Reset
POST /api/v1/auth/password-reset
```

### Users
```bash
# Get all users
GET /api/v1/users/

# Get user profile
GET /api/v1/users/me

# Update user
PUT /api/v1/users/{user_id}
```

### Vehicles
```bash
# Get all vehicles
GET /api/v1/vehicles/

# Register vehicle
POST /api/v1/vehicles/

# Get vehicle by plate
GET /api/v1/vehicles/plate/{plate_number}
```

### Vision Service
```bash
# Start camera stream
POST /streams/start

# Stop camera stream
POST /streams/stop

# Get stream status
GET /streams/status
```

## 🧪 Testing the System

### 1. Test License Plate Detection
1. **Point your phone camera** at a real license plate
2. **Hold steady** for a few seconds
3. **Check Guard Dashboard** for new alerts

### 2. Test Manual Scan
1. **Go to Guard Dashboard**
2. **Click "Manual Scan"**
3. **Enter a license plate number**
4. **Check Recent Alerts**

### 3. Test Emergency Protocol
1. **Go to Guard Dashboard**
2. **Click "Emergency Protocol"**
3. **Select emergency type**
4. **Set duration and reason**
5. **Activate protocol**

### 4. Test WebSocket Alerts
```bash
# Send test alert
curl -X POST "http://localhost:8000/api/v1/internal/test-alert" \
  -H "Content-Type: application/json" \
  -d '{"plate_number": "TEST123", "confidence_score": 85}'
```

## 🔍 Troubleshooting

### Common Issues

#### WebSocket Connection Failed
- **Check API server** is running on port 8000
- **Verify user ID** in WebSocket URL
- **Check browser console** for specific errors

#### Camera Feed Not Showing
- **Verify IP Camera Lite** is running on phone
- **Check IP address** is correct
- **Test URL** in browser first
- **Ensure same WiFi network**

#### Vision Service Not Starting
- **Install missing dependencies**:
  ```bash
  pip install uvicorn fastapi opencv-python ultralytics pytesseract
  ```
- **Check port 8001** is available
- **Verify environment variables**

#### Database Connection Issues
- **Check MySQL** is running
- **Verify database credentials** in `.env`
- **Test connection** manually

### Performance Optimization

#### For Better Detection:
- **Good lighting** on license plates
- **Steady camera** position
- **Clear view** of license plate
- **High-quality** camera settings

#### For Multiple Cameras:
- **Use different ports** for each camera
- **Monitor system resources**
- **Adjust detection intervals** if needed

## 📊 System Monitoring

### Check Service Status
```bash
# API Server health
curl http://localhost:8000/health

# Vision Service status
curl http://localhost:8001/streams/status
```

### View Logs
- **API Server**: Check terminal output
- **Vision Service**: Monitor detection logs
- **Frontend**: Check browser console

### Performance Metrics
- **Detection accuracy** in Guard Dashboard
- **Response times** in analytics
- **System uptime** in status indicators

## 🔒 Security Considerations

### Production Deployment
- **Use HTTPS** for all communications
- **Secure WebSocket** connections
- **Environment variables** for sensitive data
- **Regular security updates**
- **Database backups**

### Access Control
- **Strong passwords** for all users
- **Regular password changes**
- **Role-based permissions**
- **Audit logging**

## 📞 Support

### Getting Help
1. **Check troubleshooting** section above
2. **Review logs** for error messages
3. **Test individual components**
4. **Verify network connectivity**

### System Requirements
- **Minimum 4GB RAM** for development
- **8GB RAM recommended** for production
- **SSD storage** for better performance
- **Stable internet** for camera feeds

## 🎉 Congratulations!

You now have a fully functional vehicle access management system with:
- ✅ **Modern web interface** with neumorphic design
- ✅ **AI-powered license plate recognition**
- ✅ **Real-time alerts and notifications**
- ✅ **Phone camera integration**
- ✅ **Comprehensive dashboards**
- ✅ **Role-based access control**

The system is ready for testing and can be extended for production use!


