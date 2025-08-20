const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { program } = require('commander');
const chalk = require('chalk');

// Import config and models from the main application
const config = require('../Contract-Migration-main/config/default.json');
const User = require('../Contract-Migration-main/src/models/user');

class NginxUserManager {
    constructor() {
        this.authDir = path.join(__dirname, 'auth');
        this.usersFile = path.join(this.authDir, 'users.htpasswd');
        this.adminFile = path.join(this.authDir, 'admin.htpasswd');
        this.userListFile = path.join(this.authDir, 'user-list.json');
    }

    // Ensure auth directory exists
    ensureAuthDirectory() {
        if (!fs.existsSync(this.authDir)) {
            fs.mkdirSync(this.authDir, { recursive: true });
            console.log(chalk.green(`✅ Created auth directory: ${this.authDir}`));
        }
    }

    // Connect to MongoDB using the config
    async connectToDatabase() {
        try {
            await mongoose.connect(config.databaseUrl);
            console.log(chalk.green('✅ Connected to MongoDB'));
        } catch (error) {
            console.error(chalk.red('❌ MongoDB connection error:'), error.message);
            throw error;
        }
    }

    // Generate htpasswd entry using bcrypt
    async generateHtpasswdEntry(username, password) {
        try {
            const saltRounds = 12;
            const hash = await bcrypt.hash(password, saltRounds);
            // Convert bcrypt hash format for nginx compatibility
            const nginxHash = hash.replace('$2b$', '$2y$');
            return `${username}:${nginxHash}`;
        } catch (error) {
            throw new Error(`Failed to hash password for ${username}: ${error.message}`);
        }
    }

    // Add or update user in htpasswd file
    async updateHtpasswdFile(filePath, username, password) {
        this.ensureAuthDirectory();
        
        let entries = [];
        if (fs.existsSync(filePath)) {
            entries = fs.readFileSync(filePath, 'utf8')
                .split('\n')
                .filter(line => line.trim() && !line.startsWith(username + ':'));
        }

        const newEntry = await this.generateHtpasswdEntry(username, password);
        entries.push(newEntry);

        fs.writeFileSync(filePath, entries.join('\n') + '\n');
        return newEntry;
    }

    // Remove user from htpasswd file
    removeFromHtpasswdFile(filePath, username) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Htpasswd file not found: ${filePath}`);
        }

        const entries = fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .filter(line => line.trim() && !line.startsWith(username + ':'));

        fs.writeFileSync(filePath, entries.join('\n') + '\n');
    }

    // Sync all users from MongoDB to nginx htpasswd files
    async syncUsersFromDatabase() {
        await this.connectToDatabase();
        this.ensureAuthDirectory();

        try {
            const users = await User.find({}, 'emailId firstName lastName role');
            
            if (users.length === 0) {
                console.log(chalk.yellow('⚠️  No users found in database'));
                return;
            }

            const userEntries = [];
            const adminEntries = [];
            const userList = [];

            for (const user of users) {
                const tempPassword = 'Welcome@2025'; // Default password - should be changed on first login
                const entry = await this.generateHtpasswdEntry(user.emailId, tempPassword);
                
                // Add to appropriate file based on role
                if (user.role === 'admin') {
                    adminEntries.push(entry);
                } else {
                    userEntries.push(entry);
                }

                userList.push({
                    email: user.emailId,
                    name: `${user.firstName} ${user.lastName}`,
                    role: user.role,
                    tempPassword: tempPassword
                });

                console.log(chalk.blue(`📝 Processed: ${user.emailId} (${user.role})`));
            }

            // Write user file
            if (userEntries.length > 0) {
                fs.writeFileSync(this.usersFile, userEntries.join('\n') + '\n');
                console.log(chalk.green(`✅ Updated ${this.usersFile} with ${userEntries.length} users`));
            }

            // Write admin file
            if (adminEntries.length > 0) {
                fs.writeFileSync(this.adminFile, adminEntries.join('\n') + '\n');
                console.log(chalk.green(`✅ Updated ${this.adminFile} with ${adminEntries.length} admins`));
            }

            // Write user list for reference
            fs.writeFileSync(this.userListFile, JSON.stringify(userList, null, 2));
            console.log(chalk.green(`📄 Created user reference: ${this.userListFile}`));

            console.log(chalk.green(`\n🎉 Successfully synced ${users.length} users from database`));

        } catch (error) {
            console.error(chalk.red('❌ Error syncing users:'), error.message);
        } finally {
            await mongoose.disconnect();
        }
    }

    // Add a regular user
    async addUser(email, password) {
        try {
            await this.updateHtpasswdFile(this.usersFile, email, password);
            console.log(chalk.green(`✅ Added user: ${email}`));
        } catch (error) {
            console.error(chalk.red(`❌ Error adding user ${email}:`), error.message);
        }
    }

    // Add an admin user
    async addAdmin(email, password) {
        try {
            await this.updateHtpasswdFile(this.adminFile, email, password);
            console.log(chalk.green(`✅ Added admin: ${email}`));
        } catch (error) {
            console.error(chalk.red(`❌ Error adding admin ${email}:`), error.message);
        }
    }

    // Remove user from both files
    removeUser(email) {
        let removed = false;

        // Try to remove from users file
        try {
            this.removeFromHtpasswdFile(this.usersFile, email);
            removed = true;
        } catch (error) {
            // User might not exist in users file
        }

        // Try to remove from admin file
        try {
            this.removeFromHtpasswdFile(this.adminFile, email);
            removed = true;
        } catch (error) {
            // User might not exist in admin file
        }

        if (removed) {
            console.log(chalk.green(`✅ Removed user: ${email}`));
        } else {
            console.log(chalk.yellow(`⚠️  User not found: ${email}`));
        }
    }

    // List all users
    listUsers() {
        console.log(chalk.cyan('\n📋 Current nginx users:'));
        
        // List regular users
        if (fs.existsSync(this.usersFile)) {
            const users = fs.readFileSync(this.usersFile, 'utf8')
                .split('\n')
                .filter(line => line.trim())
                .map(line => line.split(':')[0]);
            
            console.log(chalk.blue('\n👥 Regular Users:'));
            users.forEach((user, index) => {
                console.log(`  ${index + 1}. ${user}`);
            });
        }

        // List admin users
        if (fs.existsSync(this.adminFile)) {
            const admins = fs.readFileSync(this.adminFile, 'utf8')
                .split('\n')
                .filter(line => line.trim())
                .map(line => line.split(':')[0]);
            
            console.log(chalk.red('\n👑 Admin Users:'));
            admins.forEach((admin, index) => {
                console.log(`  ${index + 1}. ${admin}`);
            });
        }

        // Show user list file if exists
        if (fs.existsSync(this.userListFile)) {
            console.log(chalk.green(`\n📄 Detailed user info available in: ${this.userListFile}`));
        }
    }
}

// CLI interface
if (require.main === module) {
    const manager = new NginxUserManager();

    program
        .name('nginx-user-manager')
        .description('Manage nginx multiuser authentication')
        .version('1.0.0');

    program
        .command('sync')
        .description('Sync all users from MongoDB to nginx htpasswd files')
        .action(async () => {
            await manager.syncUsersFromDatabase();
        });

    program
        .command('add')
        .description('Add a regular user')
        .argument('<email>', 'user email')
        .argument('<password>', 'user password')
        .action(async (email, password) => {
            await manager.addUser(email, password);
        });

    program
        .command('add-admin')
        .description('Add an admin user')
        .argument('<email>', 'admin email')
        .argument('<password>', 'admin password')
        .action(async (email, password) => {
            await manager.addAdmin(email, password);
        });

    program
        .command('remove')
        .description('Remove a user from both user and admin files')
        .argument('<email>', 'user email')
        .action((email) => {
            manager.removeUser(email);
        });

    program
        .command('list')
        .description('List all current users')
        .action(() => {
            manager.listUsers();
        });

    program.parse();
}

module.exports = NginxUserManager;