var runtime = TWEEG_RUNTIME();
$TWEEG(runtime);

console.log(runtime.exec("tmp/include.html.twig", { foo: "<BLERG>" }));
