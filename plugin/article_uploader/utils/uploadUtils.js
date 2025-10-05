class UploadUtils {
    constructor(plugin) {
        this.plugin = plugin;
        this.CryptoJS = null;
        this.yaml = null;
    }

    // 懒加载 CryptoJS 模块
    lazyLoadCryptoJS = () => {
        if (!this.CryptoJS) {
            this.CryptoJS = require('./crypto-js/core');
            require('./crypto-js/hmac');
            require('./crypto-js/sha256');
            require('./crypto-js/enc-base64');
        }
    }

    lazyLoadYaml = () => {
        if (this.yaml) {
            return;
        }
        try {
            this.yaml = require('../../global/core/lib/js-yaml.js');
        } catch (error) {
            try {
                this.yaml = require('../../global/core/lib/js-yaml');
            } catch (innerError) {
                const utils = this.plugin && this.plugin.utils;
                if (utils && typeof utils.requireFilePath === 'function') {
                    this.yaml = utils.requireFilePath('./plugin/global/core/lib/js-yaml.js');
                } else {
                    throw error;
                }
            }
        }
    }

    // 生成UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // 处理文件
    readAndSplitFile = (filePath) => {
        const Notification = require('../utils/customNotification.js').plugin;
        const notification = new Notification();
        try {
            const fs = this.plugin.utils.Package.Fs;
            const data = fs.readFileSync(filePath, 'utf-8').trim();
            if (!data) {
                throw new Error('文件内容为空');
            }

            const { title, content, extraData } = this.extractWithFrontmatter(data);
            if (title === '' || content.trim() === '') {
                throw new Error('缺少标题或正文');
            }
            return { title, content, extraData };
        } catch (error) {
            notification.showNotification('文件格式读取失败', "error");
            console.error('Error reading file:', error);
            return null;
        }
    }

    extractWithFrontmatter = (raw) => {
        const delimiter = /^---\s*$/m;
        if (raw.startsWith('---')) {
            const parts = raw.split(delimiter);
            if (parts.length >= 3) {
                const frontmatter = parts[1];
                const body = parts.slice(2).join('\n').trim();
                this.lazyLoadYaml();
                const meta = this.parseFrontmatter(frontmatter);
                const title = (meta.title || '').toString().trim() || this.extractTitleFromBody(body);
                return { title, content: body, extraData: meta };
            }
        }

        const lines = raw.split('\n');
        const title = this.cleanHeading(lines[0]);
        const content = lines.slice(1).join('\n');
        return { title, content, extraData: {} };
    }

    cleanHeading = (line = '') => line.trim().replace(/^#+/, '').trim();

    extractTitleFromBody = (body = '') => {
        const match = body.match(/^#\s*(.+)$/m);
        return match ? match[1].trim() : '';
    }

    parseFrontmatter = (frontmatter) => {
        const replacements = {
            '‘': "'",
            '’': "'",
            '“': '"',
            '”': '"',
            '，': ',',
        };
        const normalize = (input) => input.replace(/[‘’“”，]/g, (match) => replacements[match] || match);
        try {
            const meta = this.yaml.load(frontmatter) || {};
            return this.normalizeMeta(meta);
        } catch (error) {
            try {
                const meta = this.yaml.load(normalize(frontmatter)) || {};
                return this.normalizeMeta(meta);
            } catch (innerError) {
                throw error;
            }
        }
    }

    normalizeMeta = (meta = {}) => {
        if (typeof meta.tags === 'string') {
            meta.tags = meta.tags
                .split(/[,，]/)
                .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
                .filter(Boolean);
        }
        if (Array.isArray(meta.tags)) {
            meta.tags = meta.tags
                .map((tag) => (typeof tag === 'string' ? tag.trim().replace(/^['"]|['"]$/g, '') : tag))
                .filter((tag) => typeof tag === 'string' && tag.length > 0);
        }
        return meta;
    }

    relocateImages = (content, repoRoot) => {
        const fs = this.plugin.utils.Package.Fs;
        const path = this.plugin.utils.Package.Path;
        const uploads = [];
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const destDir = path.join(repoRoot, 'public', 'uploads', year, month);
        const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
        let updated = content;
        fs.mkdirSync(destDir, { recursive: true });

        let match;
        while ((match = imageRegex.exec(content)) !== null) {
            const original = match[0];
            let imagePath = match[1].trim();
            if (!imagePath) continue;
            if ((imagePath.startsWith('"') && imagePath.endsWith('"')) || (imagePath.startsWith("'") && imagePath.endsWith("'"))) {
                imagePath = imagePath.slice(1, -1);
            }
            if (!path.isAbsolute(imagePath) || !fs.existsSync(imagePath)) {
                continue;
            }

            const ext = path.extname(imagePath);
            const baseName = path.basename(imagePath, ext);
            let targetName = `${baseName}${ext}`;
            let targetPath = path.join(destDir, targetName);
            let index = 1;
            while (fs.existsSync(targetPath)) {
                targetName = `${baseName}-${index}${ext}`;
                targetPath = path.join(destDir, targetName);
                index += 1;
            }

            fs.copyFileSync(imagePath, targetPath);
            const publicPath = `/uploads/${year}/${month}/${targetName}`;
            const relativePath = path.relative(repoRoot, targetPath);
            const replacement = original.replace(match[1], publicPath);
            updated = updated.replace(original, replacement);
            uploads.push({ absolute: targetPath, publicPath, relativePath });
        }

        return { content: updated, assets: uploads };
    }

    // 获取签名
    getSign = (uuid, url) => {
        this.lazyLoadCryptoJS();
        const parsedUrl = new URL(url);
        const _url = parsedUrl.pathname;

        const ekey = "9znpamsyl2c7cdrr9sas0le9vbc3r6ba";
        const xCaKey = "203803574";
        const toEnc = `POST\napplication/json, text/plain, */*\n\napplication/json;\n\nx-ca-key:${xCaKey}\nx-ca-nonce:${uuid}\n${_url}`;
        const hmac = this.CryptoJS.HmacSHA256(toEnc, ekey);
        return this.CryptoJS.enc.Base64.stringify(hmac);
    }
}

module.exports = UploadUtils;
