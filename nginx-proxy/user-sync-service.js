const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

class UserSyncService {
    constructor() {
        this.nginxAuthDir = 'C:/nginx/conf/auth';
        this.usersFile = path.join(this.nginxAuthDir, 'users.htpasswd');
        this.adminFile = path.join(this.nginxAuthDir, 'admin.htpasswd');
        this.tempPasswordsFile = path.join(__dirname, 'temp-passwords.json');
        
        // Email configuration
        this.emailTransporter = nodemailer.createTransport({
            // Configure your email service here
            service: 'gmail', // or your email service
            auth: {
                user: process.env.EMAIL_USER || 'your-app@company.com',
                pass: process.env.EMAIL_PASS || 'your-app-password'
            }
        });
    }

    // Generate secure temporary password
    generateTempPassword() {
        return crypto.randomBytes(8).toString('hex') + '@' + Math.floor(Math.random() * 100);
    }

    // Store temporary password for user
    storeTempPassword(email, tempPassword) {
        let tempPasswords = {};
        if (fs.existsSync(this.tempPasswordsFile)) {
            tempPasswords = JSON.parse(fs.readFileSync(this.tempPasswordsFile, 'utf8'));
        }
        
        tempPasswords[email] = {
            password: tempPassword,
            created: new Date().toISOString(),
            used: false
        };
        
        fs.writeFileSync(this.tempPasswordsFile, JSON.stringify(tempPasswords, null, 2));
    }

    // Mark temporary password as used
    markTempPasswordUsed(email) {
        if (fs.existsSync(this.tempPasswordsFile)) {
            const tempPasswords = JSON.parse(fs.readFileSync(this.tempPasswordsFile, 'utf8'));
            if (tempPasswords[email]) {
                tempPasswords[email].used = true;
                fs.writeFileSync(this.tempPasswordsFile, JSON.stringify(tempPasswords, null, 2));
            }
        }
    }

    // Add user to nginx htpasswd file
    async addNginxUser(email, password, role = 'user') {
        const entry = `${email}:${password}`;
        const filePath = role === 'admin' ? this.adminFile : this.usersFile;
        
        // Ensure directory exists
        if (!fs.existsSync(this.nginxAuthDir)) {
            fs.mkdirSync(this.nginxAuthDir, { recursive: true });
        }

        // Read existing entries
        let entries = [];
        if (fs.existsSync(filePath)) {
            entries = fs.readFileSync(filePath, 'utf8')
                .split('\n')
                .filter(line => line.trim() && !line.startsWith(email + ':'));
        }

        // Add new entry
        entries.push(entry);
        fs.writeFileSync(filePath, entries.join('\n') + '\n');

        // If user role, also add to users file (so they can access APIs)
        if (role === 'admin') {
            // Admin users should also be able to access regular APIs
            const userEntries = fs.existsSync(this.usersFile) ? 
                fs.readFileSync(this.usersFile, 'utf8').split('\n').filter(line => line.trim() && !line.startsWith(email + ':')) : [];
            userEntries.push(entry);
            fs.writeFileSync(this.usersFile, userEntries.join('\n') + '\n');
        }

        console.log(`✅ Added ${role} user to nginx: ${email}`);
    }

    // Remove user from nginx files
    async removeNginxUser(email) {
        [this.usersFile, this.adminFile].forEach(filePath => {
            if (fs.existsSync(filePath)) {
                const entries = fs.readFileSync(filePath, 'utf8')
                    .split('\n')
                    .filter(line => line.trim() && !line.startsWith(email + ':'));
                fs.writeFileSync(filePath, entries.join('\n') + '\n');
            }
        });
        console.log(`✅ Removed user from nginx: ${email}`);
    }

    // Update user password in nginx files
    async updateNginxUserPassword(email, newPassword) {
        const userRole = await this.getUserRole(email);
        await this.removeNginxUser(email);
        await this.addNginxUser(email, newPassword, userRole);
        console.log(`✅ Updated password for nginx user: ${email}`);
    }

    // Get user role from nginx files
    async getUserRole(email) {
        if (fs.existsSync(this.adminFile)) {
            const adminContent = fs.readFileSync(this.adminFile, 'utf8');
            if (adminContent.includes(email + ':')) {
                return 'admin';
            }
        }
        return 'user';
    }

    // Reload nginx configuration
    async reloadNginx() {
        const { exec } = require('child_process');
        return new Promise((resolve, reject) => {
            exec('cd C:/nginx && ./nginx.exe -s reload', (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ Error reloading nginx:', error);
                    reject(error);
                } else {
                    console.log('✅ Nginx configuration reloaded');
                    resolve();
                }
            });
        });
    }

    // Send email with credentials
    async emailUserCredentials(email, tempPassword, isNewUser = true) {
        const subject = isNewUser ? 'Welcome! Your Account Credentials' : 'Your Temporary Password';
        const loginUrl = 'http://localhost/'; // Your frontend URL
        
        const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${isNewUser ? 'Welcome to Our Platform!' : 'Password Reset'}</h2>
            
            ${isNewUser ? `
            <p>Your account has been successfully created! Here are your login credentials:</p>
            ` : `
            <p>Your password has been reset. Here are your temporary credentials:</p>
            `}
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Temporary Password:</strong> <code style="background-color: #e0e0e0; padding: 2px 5px;">${tempPassword}</code></p>
                <p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
            </div>
            
            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                <p><strong>⚠️ Important Security Notice:</strong></p>
                <ul>
                    <li>This is a <strong>temporary password</strong></li>
                    <li>You will be prompted to change it on first login</li>
                    <li>Do not share these credentials with anyone</li>
                    <li>This email contains sensitive information - please delete after use</li>
                </ul>
            </div>
            
            <h3>Getting Started:</h3>
            <ol>
                <li>Visit <a href="${loginUrl}">${loginUrl}</a></li>
                <li>Enter your email and temporary password</li>
                <li>Follow the prompts to set your new password</li>
                <li>Start using the platform!</li>
            </ol>
            
            <p style="color: #666; font-size: 12px; margin-top: 30px;">
                If you didn't expect this email, please contact our support team immediately.
            </p>
        </div>`;

        const mailOptions = {
            from: process.env.EMAIL_USER || 'noreply@company.com',
            to: email,
            subject: subject,
            html: htmlContent
        };

        try {
            await this.emailTransporter.sendMail(mailOptions);
            console.log(`✅ Email sent to: ${email}`);
        } catch (error) {
            console.error('❌ Error sending email:', error);
            // Don't fail the user creation if email fails
        }
    }

    // Main function: Sync new user from MongoDB to nginx
    async syncNewUser(mongoUser) {
        try {
            const tempPassword = this.generateTempPassword();
            
            // Step 1: Add to nginx
            await this.addNginxUser(mongoUser.emailId, tempPassword, mongoUser.role);
            
            // Step 2: Store temporary password
            this.storeTempPassword(mongoUser.emailId, tempPassword);
            
            // Step 3: Send credentials via email
            await this.emailUserCredentials(mongoUser.emailId, tempPassword, true);
            
            // Step 4: Reload nginx
            await this.reloadNginx();
            
            console.log(`🎉 Successfully synced new user: ${mongoUser.emailId}`);
            return { success: true, tempPassword };
        } catch (error) {
            console.error(`❌ Error syncing user ${mongoUser.emailId}:`, error);
            throw error;
        }
    }

    // Handle password change
    async handlePasswordChange(email, oldPassword, newPassword) {
        try {
            // Verify old password (basic check)
            const tempPasswords = fs.existsSync(this.tempPasswordsFile) ? 
                JSON.parse(fs.readFileSync(this.tempPasswordsFile, 'utf8')) : {};
            
            const tempPassData = tempPasswords[email];
            if (tempPassData && !tempPassData.used && tempPassData.password === oldPassword) {
                // Update nginx password
                await this.updateNginxUserPassword(email, newPassword);
                
                // Mark temp password as used
                this.markTempPasswordUsed(email);
                
                // Reload nginx
                await this.reloadNginx();
                
                console.log(`✅ Password changed for user: ${email}`);
                return { success: true };
            } else {
                throw new Error('Invalid old password or password already changed');
            }
        } catch (error) {
            console.error(`❌ Error changing password for ${email}:`, error);
            throw error;
        }
    }

    // Sync all MongoDB users to nginx (for initial migration)
    async syncAllUsers() {
        try {
            const User = require('../Contract-Migration-main/src/models/user');
            const users = await User.find({});
            
            console.log(`📊 Found ${users.length} users in database`);
            
            let successCount = 0;
            let errorCount = 0;
            
            for (const user of users) {
                try {
                    await this.syncNewUser(user);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to sync user ${user.emailId}:`, error.message);
                    errorCount++;
                }
            }
            
            console.log(`📈 Sync complete: ${successCount} success, ${errorCount} errors`);
            return { success: successCount, errors: errorCount };
        } catch (error) {
            console.error('❌ Error during bulk sync:', error);
            throw error;
        }
    }
}

module.exports = UserSyncService;