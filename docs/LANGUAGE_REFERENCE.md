# Jargon Language Reference

Jargon is intentionally small. The goal is readable structured logic, not full Python.

## Commands

### SET

Assign a value:

```jargon
SET name ("Maya")
SET total (2 + 3)
SET nums ([1, 2, 3])
```

Update a list item:

```jargon
SET nums[1] (50)
```

### PRINT

Evaluate and print an expression:

```jargon
PRINT total
PRINT "Done"
```

### ASK

Request input:

```jargon
ASK "What is your age?" as age
PRINT age
```

When `ASK` is reached without an answer, the result status becomes `waiting_for_input` and includes `ask` and `ask_var`.

### ADD and REMOVE

Work with lists:

```jargon
SET names ([])
ADD "Maya" to names
REMOVE "Maya" from names
```

### IF / ELSE / END

Branch on a condition:

```jargon
IF score is greater than or equal to 60 THEN
    PRINT "Pass"
ELSE
    PRINT "Try again"
END
```

`THEN` is accepted but optional.

### REPEAT

Repeat a fixed number of times:

```jargon
REPEAT 3 times
    PRINT "hello"
END
```

The count may be an expression:

```jargon
SET count (3)
REPEAT count times
    PRINT count
END
```

### REPEAT_UNTIL

Repeat until a condition becomes true:

```jargon
SET i (0)
REPEAT_UNTIL i reaches end of nums
    PRINT nums[i]
    SET i (i + 1)
END
```

### REPEAT_FOR_EACH

Loop through a list-like value:

```jargon
REPEAT_FOR_EACH item in [1, 2, 3]
    PRINT item
END
```

### BREAK

Exit the innermost loop:

```jargon
REPEAT 10 times
    PRINT "once"
    BREAK
END
```

Using `BREAK` outside a loop is a normal interpreter error.

## Conditions

Supported comparison phrases:

- `is equal to`
- `is not equal to`
- `is greater than`
- `is greater than or equal to`
- `is less than`
- `is less than or equal to`
- `is in`
- `is not in`
- `reaches end of`
- `is even`
- `is odd`

Logical operators:

```jargon
IF score is greater than 80 AND bonus is equal to True THEN
    PRINT "Great"
END

IF name is equal to "Maya" OR name is equal to "Leen" THEN
    PRINT "Known student"
END
```

`AND` has higher precedence than `OR`.

## Expressions

Allowed expression features include:

- Numbers, strings, booleans, `None`
- Lists, tuples, and dictionaries with string keys
- Indexing and slicing
- Arithmetic: `+`, `-`, `*`, `/`, `//`, `%`, bounded `**`
- Comparisons and boolean operators inside expressions
- Safe functions: `abs`, `bool`, `float`, `int`, `len`, `list`, `max`, `min`, `range`, `round`, `sorted`, `str`, `sum`

Unsupported Python features are rejected, including imports, attributes, comprehensions, lambdas, and assignments inside expressions.

## Limits

`JargonLimits` bounds source size, expression size, loop iterations, output size, numbers, strings, collections, and error logs. The defaults are meant to keep hostile or malformed programs from crashing or hanging the host app.

For untrusted users, use:

```python
from jargon_interpreter import run_sandboxed
```
