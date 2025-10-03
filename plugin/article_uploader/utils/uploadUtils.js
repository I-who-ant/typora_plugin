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
                const meta = this.yaml.load(frontmatter) || {};
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
