#! /usr/bin/env node

require("../tweeg");
require("../runtime");

var glob = require("glob");
var path = require("path");
var fs = require("fs");
var UglifyJS = require("uglify-js");

var option_tests = process.argv[2];
if (!option_tests) {
    option_tests = path.join(__dirname, "**/*.html.twig");
}

glob(option_tests, function(er, files){
    console.time("Test suite");
    files.forEach(runTest);
    console.timeEnd("Test suite");
    console.log(`${count_test_files} test files containing ${count_tests} tests.  ${count_failed} failures.`);
    process.exit(count_failed);
});

var count_test_files = 0;
var count_tests = 0;
var count_failed = 0;

function runTest(filename) {
    count_test_files++;
    var testname = path.relative(__dirname, filename);
    console.log(`Running ${testname}`);
    var testdata = fs.readFileSync(filename, "utf8");
    testdata = testdata.replace(/^#.*\n/mg, "");
    var rx_head = /^-----\s*(file|input|output)\s*(?:\:\s*([a-z0-9_.-]+))?\s*/mgi;
    var rx_body = /[^]*?(?=^-----)/mg;
    var pos = 0;
    var runtime = TWEEG_RUNTIME();
    var tweeg = TWEEG(runtime).init();
    var head;

    var code = "";
    var main = null;
    var last_args = {};
    var compiled = false;
    var case_number = 0;

    while ((head = rx_head.exec(testdata))) {
        rx_body.lastIndex = rx_head.lastIndex;
        let data = rx_body.exec(testdata);
        if (data) {
            data = data[0];
            rx_head.lastIndex = rx_body.lastIndex;
        } else {
            data = testdata.substr(rx_head.lastIndex);
        }
        data = normalize_space(data);

        if (/^file/i.test(head[1])) {
            let filename = head[2] || "index.html.twig";
            if (!main) main = filename;
            let ast = tweeg.parse(data);
            let res = tweeg.compile(ast);
            let part = `$REGISTER(${JSON.stringify(filename)}, ${res.code});`;
            code += part;

            // try {
            //     let tmp = UglifyJS.parse(part);
            //     let beauty = tmp.print_to_string({ beautify: true });
            //     console.log("\n" + beauty);
            // } catch(ex) {
            //     console.error("!!!", part);
            // }
        }
        else if (/^input/i.test(head[1])) {
            if (head[2]) {
                main = head[2];
            }
            let m = /\{\{([^]*)\}\}/.exec(data);
            if (m) {
                data = `{${m[1]}}`;
            }
            last_args = (1,eval)(`(${data})`);
        }
        else if (/^output/i.test(head[1])) {
            if (head[2]) {
                main = head[2];
            }
            count_tests++;
            case_number++;
            new Function(`return ${TWEEG.wrap_code(code)};`)()(runtime);
            var output = normalize_space(runtime.exec(main, last_args));
            if (output != data) {
                count_failed++;
                console.log(`-- failed case ${case_number}, output was «${output}»`);
            }
        }
    }
}

function normalize_space(text) {
    return text.trim().split(/\s*\n+\s*/).map(str => str.trim()).join("\n");
}
