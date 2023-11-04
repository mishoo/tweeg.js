# TweegJS: a Twig -> JavaScript compiler

**This project is sponsored by [eMAG](http://www.emag.ro/) — the biggest online retailer in Romania.**

Tweeg takes one or more [Twig](http://twig.sensiolabs.org/) templates as input, and produces a single minified JavaScript file that you can load with a `<script>` tag (along with a very small [runtime](./runtime.js)) in order to be able to render those templates on the client.  Rendering will be quite fast, since there's no parsing/compilation needed at that time.  In other words, your Twig templates become executable JavaScript.  The [parser and compiler](./tweeg.js) are not needed in the browser, unless for some reason you need to generate templates dynamically.

## Install from NPM

```sh
npm install tweeg.js
```

## Sample usage

```sh
[~/tmp/twig] $ ls
footer.html.twig  header.html.twig  index.html.twig

[~/tmp/twig] $ cat header.html.twig
```
```html.twig
<div class="section">
  <h1>{{ title }}</h1>
```
```sh
[~/tmp/twig] $ cat index.html.twig
```
```html.twig
{% set title = "Hello World!" %}
{% include "header.html.twig" %}
<p>{{ content }}</p>
{% include "footer.html.twig" %}
```
```sh
[~/tmp/twig] $ cat footer.html.twig
```
```html.twig
</div><!-- {{ title }} -->
```

Compile it:

```sh
[~/tmp/twig] $ tweeg -b index.html.twig > templates.js
```

The output looks like this:

```js
function $TWEEG($TR) {
    var $ESC_html = $TR.escape_html, $INCLUDE = $TR.include, $MERGE = $TR.merge, $OUT = $TR.out, $REGISTER = $TR.register;
    $REGISTER("header.html.twig", function() {
        return {
            $main: function($DATA) {
                return $OUT([ '<div class="section">\n  <h1>', $ESC_html($DATA.title), "</h1>\n" ]);
            }
        };
    }), $REGISTER("footer.html.twig", function() {
        return {
            $main: function($DATA) {
                return $OUT([ "</div><!-- ", $ESC_html($DATA.title), " -->\n" ]);
            }
        };
    }), $REGISTER("index.html.twig", function() {
        return {
            $main: function($DATA) {
                var title, content = $DATA.content;
                return $OUT([ (title = "Hello World!", ""), "\n", $INCLUDE("header.html.twig", $MERGE({}, $DATA, {
                    title: title
                })), "\n<p>", $ESC_html(content), "</p>\n", $INCLUDE("footer.html.twig", $MERGE({}, $DATA, {
                    title: title
                })), "\n" ]);
            }
        };
    });
}
```

If we don't pass `-b` we get the [uglified](https://github.com/mishoo/UglifyJS2/) version, which is considerably smaller:

```sh
[~/tmp/twig] $ tweeg index.html.twig
```

produces:

```js
function $TWEEG(t){var n=t.escape_html,e=t.include,i=t.merge,r=t.out,o=t.register;o("header.html.twig",function(){return{$main:function(t){return r(['<div class="section">\n  <h1>',n(t.title),"</h1>\n"])}}}),o("footer.html.twig",function(){return{$main:function(t){return r(["</div><!-- ",n(t.title)," -->\n"])}}}),o("index.html.twig",function(){return{$main:function(t){var o,l=t.content;return r([(o="Hello World!",""),"\n",e("header.html.twig",i({},t,{title:o})),"\n<p>",n(l),"</p>\n",e("footer.html.twig",i({},t,{title:o})),"\n"])}}})}
```

You can notice that, although we only passed `index.html.twig` as argument, Tweeg included all the templates that `index.html.twig` depends on.  This happens automatically as long as you use constant expressions in your `include` tags (i.e. strings or arrays of strings).  If you use more complex expressions, then you should list dependencies explicitly in the command line.

As you can see, the generated code contains a single function (`$TWEEG`).  It takes a runtime object as argument, and registers all three templates.  It can be used for example like this:

```html
<script src="/path/to/tweeg/runtime.js"></script> <!-- load the runtime -->
<script src="templates.js"></script> <!-- load the compiled templates -->
<script>
  // we need to instantiate the runtime object (notice, no `new`)
  var TMPL = TWEEG_RUNTIME();
  // extend now as needed, such as add your runtime filters. details TBD.
  TMPL.filter.static_url = function(str) {
    return "//assets.example.com/" + str;
  };
  // now instantiate the templates
  $TWEEG(TMPL);
</script>
```

When you need to render your template, you can do:

```js
div.innerHTML = TMPL.exec("index.html.twig", {
  content: "Lorem ipsum"
});
```

## Support level

The following statement tags are implemented, with the same semantics as in Twig:

- [`autoescape`](http://twig.sensiolabs.org/doc/3.x/tags/autoescape.html) (only “html” and “js” escaping strategies are implemented; “html” escaping is on by default).

- [`if`](http://twig.sensiolabs.org/doc/3.x/tags/if.html)

- [`for`](http://twig.sensiolabs.org/doc/3.x/tags/for.html)

- [`do`](http://twig.sensiolabs.org/doc/3.x/tags/do.html)

- [`set`](http://twig.sensiolabs.org/doc/3.x/tags/set.html)

- [`macro`](http://twig.sensiolabs.org/doc/3.x/tags/macro.html), along with [`from`](https://twig.symfony.com/doc/3.x/tags/from.html) and [`import`](https://twig.symfony.com/doc/3.x/tags/import.html).

- [`spaceless`](http://twig.sensiolabs.org/doc/3.x/tags/spaceless.html) (poorly implemented, we could do better here)

- [`include`](http://twig.sensiolabs.org/doc/3.x/tags/include.html), also [as function](https://twig.symfony.com/doc/3.x/functions/include.html)

- [`with`](http://twig.sensiolabs.org/doc/3.x/tags/with.html)

- [`filter`](http://twig.sensiolabs.org/doc/3.x/tags/filter.html)

- [`verbatim`](http://twig.sensiolabs.org/doc/3.x/tags/verbatim.html)

- [`block`](http://twig.sensiolabs.org/doc/3.x/tags/block.html), [`extends`](http://twig.sensiolabs.org/doc/3.x/tags/extends.html), [`use`](http://twig.sensiolabs.org/doc/3.x/tags/use.html), [`embed`](http://twig.sensiolabs.org/doc/3.x/tags/embed.html),
[`block` function](https://twig.symfony.com/doc/3.x/functions/block.html),
[`parent` function](https://twig.symfony.com/doc/3.x/functions/parent.html)

## Known issues / differences from Twig

- The runtime might be missing some filters/functions that are available in PHP Twig.  We don't guarantee that all Twig filters will be available in this particular package, but it's easy to add new filters in your own code (see next section).

- No [`is constant`](http://twig.sensiolabs.org/doc/2.x/tests/constant.html) operator.

- No support for the `_context` variable.

- … probably more, please report issues if you find them.  We strive for reasonably good compatibility with PHP Twig, because we need to run the *same* templates both on server and on client.

## Runtime extension

The [runtime](./runtime.js) currently has one global function (`TWEEG_RUNTIME`) that you need to call in order to get the runtime object.  To define your own functions and filters then, you just insert it in the appropriate property of that object.  Example:

```js
var my_runtime = TWEEG_RUNTIME();
my_runtime.filter.money = function(number) {
    return "$" + number.toFixed(2) + " USD";
}
```

Then you will be able to display a price like this:

```html.twig
{{ product.price | money }}
```

To define functions, place them in `my_runtime.func`.

## Using the API to compile templates

```js
var tweeg = require("tweeg.js");
var code = tweeg.compile([
    "templates/index.html.js",
    "templates/foo.html.js"
], options);
```

`tweeg.compile` takes an array of templates (must be file names; if relative, they must be accessible from the current directory).  The second argument is optional and it can contain:

- `paths` — an object defining special substitutions for variables in `include` tags.  Details below.

- `base` — a string specifying the base path to be cut off from template names in the output.

- `beautify` — pass `true` if you want the result to be “readable” (well, notice the quotes).  By default it goes through UglifyJS.

- `escape` — the escaping strategy (`"html"` by default).

In our case, all `include` tags look like this:

```html.twig
{% include '@OurBundle/common/stuff/template.html.twig' %}
```

That's how they work on the server, and we don't have much choice.  So, to make those templates work on the client as well, we compile with these options (remember, compilation does not take place in the browser):

```js
{
  paths: {
    OurBundle: "/full/path/to/our/twig/templates"
  },
  base: "/full/path/to/our/twig/templates"
}
```

In effect, the `paths` option allows Tweeg to properly locate `include`-ed templates, and the `base` option tells it to strip that part from the template names when registering them into the JS runtime, so in JS we can just say:

```js
runtime.exec("common/stuff/template.html.twig'")
```

without caring about any prefix.

## Using the low-level API to compile one template

Warning: this API is kinda ugly, but it's not intended for public consumption. Still, you have to understand it if you need to implement syntactic extensions (i.e. custom tags).

You've already met the [`runtime`](./runtime.js).  It defines a single global function (`TWEEG_RUNTIME`) that you must call in order to instantiate a runtime object (notice, no `new` required).

The parser and compiler are defined in [`tweeg.js`](./tweeg.js).  Again, this file defines one global function (`TWEEG`) that will return an object containing methods to parse and compile a single template.  Both this and the runtime are written in ES5 and without any dependencies, so they can run in the browser unchanged (hence the global functions instead of using `exports`).

Here's some sample usage:

```js
require("./tweeg");
require("./runtime");
var runtime = TWEEG_RUNTIME(); // instantiate the runtime
var tweeg = TWEEG(runtime);    // instantiate the compiler
tweeg.init();                  // initialize the compiler
```

The reason we have two steps for creating the compiler (instantiate, then init) is because at some point we might allow implementing custom expressions (operators).  But for now this isn't really supported.

Next, let's compile a simple template:

```js
var ast = tweeg.parse("<h1>{{ title }}</h1>");
var tmpl = tweeg.compile(ast);
var code = TWEEG.wrap_code("return " + tmpl.code);
var func = new Function("return " + code)()(runtime)();   // yes, really
var result = func.$main({ title: "Hello World" });
console.log(result);                                      // <p>Hello World</p>
```

To briefly describe what happens:

- `tweeg.parse` takes a template (as a string) and returns an [abstract syntax tree](http://lisperator.net/pltut/parser/) (AST) for it.

- `tweeg.compile` takes an AST and produces JavaScript code, as a string, containing a single function for that template.  That function is expected to be called in an environment containing several variables (see `TWEEG.wrap_code`).

- `TWEEG.wrap_code` embeds the given code in another function that defines the required variables.  This function takes a single argument (the runtime object).

- To instantiate the actual template, we must call all these functions, making sure we pass the runtime to the function resulted from `TWEEG.wrap_code`.

- Finally, an instantiated template is a simple object having a `$main` method. Call that with the template arguments in order to run the template.

It could also help to take a look in the high-level “compiler”​ (sorry for the name confusion, but you know, naming things is one of the most difficult problems in computer science).  See it in [`compiler.js`](./compiler.js).  It uses the low-level API in order to compile one or more templates together.

## Parser/compiler extension

If you reached this far I will assume that you are comfortable reading source code.  See how our `CORE_TAGS` are implemented in [`tweeg.js`](./tweeg.js). Here is a (non-trivial) example of a custom tag implemented outside our core module.

Let's say we wanted to implement a `switch` tag that works like this:

```html.twig
{% switch foo %}
  {% case 1 %}
    Got one!
  {% case 2 %}
    Got two!
  {% default %}
    Dunno what gives
{% endswitch %}
```

You can notice that Tweeg does not require each tag to end with `endtag`.  It all depends on how you want to implement your custom tags.  Here's the commented code, hopefully the comments are informative enough.

```js
// as seen before, initialize the runtime and the Tweeg object
var runtime = TWEEG_RUNTIME();
var tweeg = TWEEG(runtime);
tweeg.init();

// `deftag` is the main way to define a custom tag
tweeg.deftag({
    "switch": {

        // the parser receives a single argument `X` (because naming
        // things is hard) which contains parser utilities.
        parse: function(X) {
            var expr = X.parse_expression(); // parse the switch expression
            X.skip(X.NODE_STAT_END);         // skip the end token, `%}`

            // this utility defines a predicate suitable for
            // X.parse_until, see below.  If we pass a second `true`
            // argument it will skip the encountered tag symbol,
            // otherwise it leaves it in the token stream.
            var end = X.end_body_predicate(/^(?:case|default|endswitch)$/);

            // skip to the first tag that we recognize
            X.parse_until(end);

            var cases = [];     // collect the switch cases here
            var defau = null;   // the `default` section

            // X.eof() tells us if the token stream is over.  Use this
            // rather than `while(true)` to avoid infinite loops for
            // syntactically invalid input (e.g. unterminated tag)
            while (!X.eof()) {
                var sym = X.skip(X.NODE_SYMBOL);
                if (sym.value == "case") {
                    cases.push({
                        expr: X.parse_expression(),     // the case expression
                        body: (X.skip(X.NODE_STAT_END), // skip the end token
                               X.parse_until(end))      // fetch the case body
                    });
                }
                else if (sym.value == "default") {
                    X.skip(X.NODE_STAT_END);            // skip the end token
                    defau = X.parse_until(end);         // default only has body
                }
                else if (sym.value == "endswitch") {
                    break;      // we're done
                }
            }

            // finally, skip the end token and return our AST node
            X.skip(X.NODE_STAT_END);

            // there is no need to mark it as a “switch” node, Tweeg
            // internally takes care of this.
            return { expr: expr, cases: cases, defau: defau };
        },

        // The compiler will receive three arguments: an environment
        // `env`, an object with compiler utilities `X`, and the node
        // produced by our parser above.
        //
        // It must return a string of JS code that executes our node.
        // This must be a single JS expression (no statements
        // allowed!).  If you need to execute statements, you can
        // embed everything in an IIFE.
        compile: function(env, X, node) {
            // to keep things simple, we will compile our `switch`
            // node as a series of conditional expressions, using the
            // ternary operator.  Essentially, we will produce this:
            //
            // foo==1?"Got one":foo==2?"Got two":"Dunno what gives"

            // If we have multiple cases, we'll have to compare the
            // expression with a value for each case.  We must be
            // careful to not compile the expression multiple times,
            // because then it will *run* multiple times.  Therefore
            // we invent a variable name to keep the value of the
            // expression (it's guaranteed not to clash with template
            // variables).  Welcome to Lisp!
            var sym = X.gensym();
            env.def(sym); // Tweeg will take care to output a `var` for it

            // prelude: store the switch expression in this variable
            var code = sym + "=" + X.compile(env, node.expr) + ",";

            // since Tweeg already knows how to compile ternary nodes,
            // we can cheat by generating such a node for our switch.
            // That's easier than producing JS as a string.  Here's a
            // piece of recursive magic.
            var body = (function loop(i){
                if (i < node.cases.length) {
                    // if we still have at least one case, return a
                    // ternary node (NODE_COND stands for conditional)
                    return {
                        type: X.NODE_COND,
                        cond: {
                            type: X.NODE_BINARY,
                            operator: "==",
                            left: { type: X.NODE_VAR, name: sym },
                            right: node.cases[i].expr
                        },
                        then: node.cases[i].body,
                        else: loop(i + 1) // loop for the next cases
                    };
                } else {
                    // we're done, either return the default value or
                    // an empty string.
                    return node.defau || X.EMPTY_STRING;
                }
            })(0);

            // now compile the node that we just produced
            code += X.compile(env, body);

            // parenthesize the result, just in case
            return "(" + code + ")";
        }
    }
});

// test
var fs = require("fs");

var test = fs.readFileSync("switch.html.twig", "utf8");
var ast = tweeg.parse(test);
//console.log(JSON.stringify(ast, null, 2));
var result = tweeg.compile(ast);
console.log(result.code);
```

## License

MIT
