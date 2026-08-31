"""Reading a source file the way a person reads it.

Shared by the pin suites. A pin that matches inside a comment is a pin that forbids
writing history — three releases in a row have been tripped by one (a `>Draft<`
matcher hitting an <option>, a "Seeding" matcher hitting a release note, an "<input"
matcher hitting the comment explaining why the input was removed).
"""


def without_comments(text: str) -> str:
    """The surface a person can read. A comment explaining what a release deleted is
    not chrome, and a pin that cannot tell the difference forbids writing history."""
    out, i, n = [], 0, len(text)
    while i < n:
        if text.startswith("/*", i):
            i = text.find("*/", i)
            i = n if i == -1 else i + 2
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j == -1 else j
        else:
            out.append(text[i])
            i += 1
    return "".join(out)
