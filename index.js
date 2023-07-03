import path from 'node:path';
import { exec } from 'node:child_process';

export default function (options = {}) {

    options = {
        root: '.',
        bin: 'ffprobe',
        filter: 'exclude',
        include: 'data-measure-media-include',
        exclude: 'data-measure-media-exclude',
        excludeUrl: [],
        override: true,
        clear: true,
        image: true,
        video: true,
        nestedImg: false,
        ...options
    }

    const promiseList = [];

    function _isLocalPath(src) {
        try {
            return !Boolean(new URL(src));
        } catch {
            return true;
        }
    }

    function _sanitizePath(src) {
        return src.replace(/\?[^/#\?\s]*/, '').replace(/#[^/#\?\s]*/, '');
    }

    function _getMediaPath(src) {
        if (typeof src === 'undefined' || src === null || src === '') {
            return null;
        }

        if (typeof options.excludeUrl.find(exclude => src.toLowerCase().includes(exclude.toLowerCase())) !== 'undefined') {
            return null;
        }

        const input = src.split(/,\s+/).length > 1
        ? src.split(/,\s+/)[0].replace(/\s+?\d+?[xw]$/, '')
        : src.replace(/\s+?\d+?[xw]$/, '');

        if (path.extname(_sanitizePath(input)) === '.svg') {
            return null;
        }

        if (_isLocalPath(input)) {
            return path.resolve(options.root, _sanitizePath(input));
        } else {
            return null;
        }
    }

    function _getMediaData(src) {
        return new Promise((resolve, reject) => {
            const ffprobe = exec(`${options.bin} -v quiet -print_format json -show_streams -select_streams v:0 ${src}`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error: posthtml-measure-media: ${error}`);
                    reject();
                }
                if (stderr) {
                    console.error(`Error: posthtml-measure-media: stderr: ${stderr}`);
                    reject();
                }

                try {
                    const probeData = JSON.parse(stdout).streams[0];

                    const result = {
                        width: probeData.width,
                        height: probeData.height,
                    }

                    resolve(result);
                } catch {
                    console.error(`Error: posthtml-measure-media: ${src}`);
                    reject();
                }
            });
        });
    }

    function _addPromise(node, src) {
        if (src !== null) {
            _setDone(node);
            promiseList.push(_getMediaData(src).then(data => {
                if (options.override) {
                    node.attrs = {
                        ...node.attrs,
                        ...data,
                    }
                } else {
                    node.attrs = {
                        ...data,
                        ...node.attrs,
                    }
                }
            }));
        }
    }

    function _checkFilter(node, nested = false) {
        if (nested) {
            return Boolean(
                (options.filter === 'exclude' && !Object.hasOwn(node.attrs || {}, options.exclude)) ||
                (options.filter === 'include')
            );
        } else {
            return Boolean(
                (options.filter === 'exclude' && !Object.hasOwn(node.attrs || {}, options.exclude)) ||
                (options.filter === 'include' && Object.hasOwn(node.attrs || {}, options.include))
            );
        }
    }

    function _setDone(node) {
        node.attrs = {
            ...node.attrs,
            'data-measure-media-done': '',
        }
    }

    function _clearAttribute(node, attr) {
        if (Object.hasOwn(node.attrs || {}, attr)) {
            delete node.attrs[attr];
        }
    }

    return function posthtmlMeasureMedia(tree) {
        if (options.image) {
            tree.match({ tag: 'picture' }, (node) => {
                if (_checkFilter(node)) {
                    const source = node.content.filter((item) => item.tag === 'source');
                    if (source.length > 0) {
                        source.forEach((item) => {
                            if (_checkFilter(item)) {
                                const src = _getMediaPath(item.attrs.srcset);
                                _addPromise(item, src);
                            }
                        });
                    }

                    const img = node.content.find((item) => item.tag === 'img' && Object.hasOwn(item.attrs, 'src'));
                    if (source.length === 0 || (options.nestedImg && _checkFilter(img, true))) {
                        const src = typeof img !== 'undefined' ? _getMediaPath(img.attrs.src) : null;
                        _addPromise(img, src);
                    }
                    if (typeof img !== 'undefined') {
                        _setDone(img);
                    }
                } else {
                    const img = node.content.find((item) => item.tag === 'img' && Object.hasOwn(item.attrs, 'src'));
                    if (typeof img !== 'undefined') {
                        _setDone(img);
                    }
                }

                return node;
            });

            tree.match({ tag: 'img' }, (node) => {
                if (_checkFilter(node) && !Object.hasOwn(node.attrs || {}, 'data-measure-media-done')) {
                    const src = _getMediaPath(node.attrs.src);
                    _addPromise(node, src);
                }

                return node;
            });
        }

        if (options.video) {
            tree.match({ tag: 'video' }, (node) => {
                if (_checkFilter(node)) {
                    if (Object.hasOwn(node.attrs, 'src')) {
                        const src = _getMediaPath(node.attrs.src);
                        _addPromise(node, src);
                    } else {
                        const source = node.content.find((item) => item.tag === 'source' && Object.hasOwn(item.attrs, 'src'));
                        const src = typeof source !== 'undefined' ? _getMediaPath(source.attrs.src) : null;
                        _addPromise(node, src);
                    }
                }

                return node;
            });
        }

        return Promise.allSettled(promiseList).then(() => {
            tree.match([{ tag: 'picture' }, { tag: 'source' }, { tag: 'img' }, { tag: 'video' }], (node) => {
                _clearAttribute(node, 'data-measure-media-done');

                if (options.clear) {
                    _clearAttribute(node, options.exclude);
                    _clearAttribute(node, options.include);
                }

                return node;
            });

            return tree
        });
    }
}
