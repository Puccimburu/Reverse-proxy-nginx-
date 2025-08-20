const express = require('express');
const UserSyncService = require('./user-sync-service');

class WebhookHandler {
    constructor() {
        this.app = express();
        this.userSyncService = new UserSyncService();
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'OK', service: 'nginx-user-sync' });
        });

        // Webhook for new user signup
        this.app.post('/webhook/user-signup', async (req, res) => {
            try {
                const { user } = req.body;
                
                if (!user || !user.emailId) {
                    return res.status(400).json({ error: 'Invalid user data' });
                }

                console.log(`🔔 Webhook received: New user signup - ${user.emailId}`);
                
                const result = await this.userSyncService.syncNewUser(user);
                
                res.json({ 
                    success: true, 
                    message: `User ${user.emailId} synced to nginx`,
                    tempPassword: result.tempPassword // For testing - remove in production
                });
            } catch (error) {
                console.error('❌ Webhook error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Webhook for password change
        this.app.post('/webhook/password-change', async (req, res) => {
            try {
                const { email, oldPassword, newPassword } = req.body;
                
                if (!email || !oldPassword || !newPassword) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                console.log(`🔔 Webhook received: Password change - ${email}`);
                
                await this.userSyncService.handlePasswordChange(email, oldPassword, newPassword);
                
                res.json({ 
                    success: true, 
                    message: `Password updated for ${email}`
                });
            } catch (error) {
                console.error('❌ Password change error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Webhook for user deletion
        this.app.post('/webhook/user-delete', async (req, res) => {
            try {
                const { email } = req.body;
                
                if (!email) {
                    return res.status(400).json({ error: 'Email required' });
                }

                console.log(`🔔 Webhook received: User deletion - ${email}`);
                
                await this.userSyncService.removeNginxUser(email);
                await this.userSyncService.reloadNginx();
                
                res.json({ 
                    success: true, 
                    message: `User ${email} removed from nginx`
                });
            } catch (error) {
                console.error('❌ User deletion error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Manual sync all users
        this.app.post('/sync-all-users', async (req, res) => {
            try {
                console.log('🔄 Manual sync all users requested');
                
                const result = await this.userSyncService.syncAllUsers();
                
                res.json({ 
                    success: true, 
                    message: 'Bulk sync completed',
                    stats: result
                });
            } catch (error) {
                console.error('❌ Bulk sync error:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // Get user status
        this.app.get('/user-status/:email', async (req, res) => {
            try {
                const { email } = req.params;
                const role = await this.userSyncService.getUserRole(email);
                
                res.json({ 
                    email,
                    role,
                    hasNginxAccess: role !== null
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    start(port = 3001) {
        this.app.listen(port, () => {
            console.log(`🚀 Nginx User Sync Service running on port ${port}`);
            console.log(`📡 Webhook endpoints available:`);
            console.log(`   POST http://localhost:${port}/webhook/user-signup`);
            console.log(`   POST http://localhost:${port}/webhook/password-change`);
            console.log(`   POST http://localhost:${port}/webhook/user-delete`);
            console.log(`   POST http://localhost:${port}/sync-all-users`);
        });
    }
}

// Start the service if run directly
if (require.main === module) {
    const webhookHandler = new WebhookHandler();
    webhookHandler.start();
}

module.exports = WebhookHandler;