var gulp = require('gulp'),
    browserify = require('browserify'),
    watchify = require('watchify'),
    es = require('event-stream'),
    glob = require('glob'),
    gutil = require('gulp-util'),
    rename = require('gulp-rename'),
    source = require('vinyl-source-stream'),
    assign = require('lodash.assign'),
    watch = require('gulp-watch'),
    plumber = require('gulp-plumber');

var assets = ['src/**/*', '!src/js/**/*'];

var sources = 'src/js/*.js';

var out = "build";

// Browserify js, move files.
function build(dest, opts) {
    if (typeof opts == "undefined") opts = {};
    // Browserify.
    var bundle = glob(sources, function (err, files) {
        var streams = files.map(function (entry) {
            var b_opts = {
                entries: entry
            };
            if (opts.browserify) {
                for (var i in opts.browserify) {
                    b_opts[i] = opts.browserify[i];
                }
            }
            return browserify(b_opts)
                .bundle()
                .pipe(source(entry.replace(/^src\//, '')))
                .pipe(gulp.dest(dest));
        });
        return es.merge(streams);
    });
    // Assets.
    gulp.src(assets)
        .pipe(gulp.dest(dest));
    return bundle;
}

// Compile and watchify sourced file.
function watchifyFile(src, out) {
    var opts = assign({}, watchify.args, {
        entries: src,
        debug: true
    });
    var b = watchify(browserify(opts));
    function bundle() {
        return b.bundle()
            .on('error', gutil.log.bind(gutil, "Browserify Error"))
            .pipe(source(src.replace(/^src\//, '')))
            .pipe(gulp.dest(out));
    }
    b.on('update', bundle);
    b.on('log', gutil.log);
    return bundle();
}

// dev build
gulp.task('build', function() {
    return build(out, {
        browserify: {
            debug: true
        }
    });
});

gulp.task('watch', function() {
    var bundle = glob(sources, function (err, files) {
        var streams = files.map(function (entry) {
            return watchifyFile(entry, out);
        });
        return es.merge(streams);
    });
    
    gulp.src(assets)
        .pipe(watch(assets))
        .pipe(plumber())
        .pipe(gulp.dest(out));
    return bundle;
});
