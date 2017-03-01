# TweegJS: a Twig -> JavaScript compiler

**This project is sponsored by [eMAG](http://www.emag.ro/) — the biggest online retailer in Romania.**

Tweeg takes one or more [Twig](http://twig.sensiolabs.org/) templates as input, and produces a single minified JavaScript file that you can load with a `<script>` tag (along with a very small [runtime](./runtime.js)) in order to be able to render those templates on the client.  Rendering will be quite fast, since there's no parsing/compilation needed at that time.  In other words, your Twig templates become executable JavaScript.  The [parser and compiler](./tweeg.js) are not needed in the browser, unless for some reason you need to generate templates dynamically.

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
[~/tmp/twig] $ tweeg index.html.twig | uglifyjs -bc pure-getters=1,warnings=0 > templates.js
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

It will be smaller, of course, if you enable name mangling and not pretty print:

```sh
[~/tmp/twig] $ tweeg index.html.twig | uglifyjs -mc pure-getters=1,warnings=0
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

When you need to render your template now, you can do:

```js
div.innerHTML = TMPL.exec("index.html.twig", {
  content: "Lorem ipsum"
});
```

## Support level

The following statement tags are implemented, with the same semantics as in Twig:

- [`autoescape`](http://twig.sensiolabs.org/doc/2.x/tags/autoescape.html) (only “html” and “js” escaping strategies are implemented; “html” escaping is on by default).

- [`if`](http://twig.sensiolabs.org/doc/2.x/tags/if.html)

- [`for`](http://twig.sensiolabs.org/doc/2.x/tags/for.html)

- [`do`](http://twig.sensiolabs.org/doc/2.x/tags/do.html)

- [`set`](http://twig.sensiolabs.org/doc/2.x/tags/set.html)

- [`macro`](http://twig.sensiolabs.org/doc/2.x/tags/macro.html), along with `from` and `import`.

- [`spaceless`](http://twig.sensiolabs.org/doc/2.x/tags/spaceless.html) (poorly implemented, we could do better here)

- [`include`](http://twig.sensiolabs.org/doc/2.x/tags/include.html)

- [`with`](http://twig.sensiolabs.org/doc/2.x/tags/with.html)

- [`verbatim`](http://twig.sensiolabs.org/doc/2.x/tags/verbatim.html)

TODO: [block](http://twig.sensiolabs.org/doc/2.x/tags/block.html), [extends](http://twig.sensiolabs.org/doc/2.x/tags/extends.html), [use](http://twig.sensiolabs.org/doc/2.x/tags/use.html), [embed](http://twig.sensiolabs.org/doc/2.x/tags/embed.html), [filter](http://twig.sensiolabs.org/doc/2.x/tags/filter.html).  We have the infrastructure to easily implement all of these.

At expression level, we should support all of Twig except the [constant](http://twig.sensiolabs.org/doc/2.x/tests/constant.html) operator.

The runtime is missing a lot of filters / functions, but they are quite easy to implement.  Expect updates soon.

## Runtime extension

The [runtime](./runtime.js) currently has one global function (`TWEEG_RUNTIME`) that you need to call in order to get the runtime object.  To define your own functions and filters then, you just insert it in the appropriate propriety of that object.  Example:

```js

```

## Parser/compiler extension
