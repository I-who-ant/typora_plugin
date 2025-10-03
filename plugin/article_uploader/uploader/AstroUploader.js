const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const BaseUploaderInterface = require('./BaseUploaderInterface');
const Notification = require('../utils/customNotification.js').plugin;

/**
 * 将 Typora 当前 Markdown 推送到本地 Astro 博客。
 */
class AstroUploader extends BaseUploaderInterface {
    getName() {
        return 'astro';
    }

    async upload(title, content, extraData) {
        const cfg = this.config.upload.astro;
        if (!cfg || !cfg.enabled) {
            return;
        }

        const repoRoot = cfg.repo_root;
        const postsDir = cfg.posts_dir || 'src/content/posts';
        if (!repoRoot) {
            throw new Error('astro repo_root 未配置');
        }

        const targetDir = path.resolve(repoRoot, postsDir);
        const filename = this.composeFilename(title, cfg.filename_pattern);
        const targetPath = path.join(targetDir, filename);

        const { frontmatter, body } = this.composeContent(title, content, extraData);

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, `${frontmatter}\n${body}\n`, 'utf-8');

        if (cfg.auto_commit && cfg.git_cmd) {
            await this.runGitCommands(cfg.git_cmd, repoRoot, filename);
        }
    }

    composeFilename(title, pattern = '{date}-{slug}.md') {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10);
        const rawSlug = title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const slug = rawSlug.length ? rawSlug : `post-${dateStr}`;
        return pattern.replace('{date}', dateStr).replace('{slug}', slug);
    }

    composeContent(title, content, extraData) {
        const meta = extraData && typeof extraData === 'object' ? { ...extraData } : {};
        const date = meta.date || new Date().toISOString().slice(0, 10);
        const excerpt = meta.excerpt || this.deriveExcerpt(content);
        const tags = Array.isArray(meta.tags) ? meta.tags : [];
        const cover = meta.cover || '';

        const frontmatterLines = [
            '---',
            `title: '${this.escape(title)}'`,
            `date: '${date}'`,
            `excerpt: '${this.escape(excerpt)}'`,
            `tags: ${JSON.stringify(tags)}`,
        ];
        if (cover) {
            frontmatterLines.push(`cover: '${this.escape(cover)}'`);
        }
        frontmatterLines.push('---', '');

        return {
            frontmatter: frontmatterLines.join('\n'),
            body: content.trim(),
        };
    }

    deriveExcerpt(content) {
        const firstParagraph = content
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .find((p) => p.length > 0);
        if (!firstParagraph) {
            return '';
        }
        return firstParagraph.replace(/\n/g, ' ').slice(0, 120);
    }

    escape(text) {
        return (text || '').replace(/'/g, "''");
    }

    async runGitCommands(cmd, cwd, filename) {
        const notification = new Notification();
        const replaced = cmd.replaceAll('{filename}', filename);
        try {
            execSync(replaced, { cwd, stdio: 'inherit', shell: true });
            notification.showNotification(`Git 操作成功: ${replaced}`, 'success');
        } catch (error) {
            notification.showNotification(`Git 操作失败: ${error.message}`, 'error');
            throw error;
        }
    }
}

module.exports = AstroUploader;
