# Job search

![Find Jobs tab listing backend jobs in Pune with match percentages and matched skills](screenshots/find-jobs.png)

Open **Find Jobs**, type a role, optionally a location, and choose **Search Jobs**.

## How results are found

1. The API searches Google for Jobs through [SerpApi](https://serpapi.com/google-jobs-api) for the role, in the location you gave or anywhere in India. Google for Jobs collects postings from LinkedIn, Naukri, Indeed, Shine and company career sites, so results include on-site and remote jobs.
2. If SerpApi fails, is out of searches or finds nothing, the API searches [Himalayas](https://himalayas.app/api) instead. Himalayas lists remote jobs open to candidates in India. Its jobs show "via Himalayas" with a link back, as its terms require.
3. Each job gets a match score: the share of your profile skills that appear as whole words in its title or description. With no skills on your profile, every score is 0.
4. Results are sorted by score. Each one shows the site it came from.

Skills come from your profile on the **Dashboard**. Sign-up fills them from your resume, and the pencil button on the profile card edits them. Only the role is sent to the job providers; the skills are matched on the server.

## Paging

The page shows 8 jobs at a time. **Next** moves through the results already loaded, and on the last page it asks the API for the next batch: 10 jobs from SerpApi or 20 from Himalayas. The API answers each batch with a cursor for the next one, which records the provider, so a search that started on Himalayas stays on Himalayas.

## Quota and cache

- SerpApi's free plan allows 250 searches a month. Each batch is one search.
- Every batch is cached in MongoDB (the `jobsearchcaches` collection) for 6 hours. The same role, location and page within that time costs nothing and answers at once.
- When the monthly searches run out, new searches use Himalayas until the quota resets.

## Settings

| Variable in `backend/.env` | Value |
|---|---|
| `SERPAPI_KEY` | Key from serpapi.com. Without it, every search uses Himalayas. |
| `HIMALAYAS_API_KEY` | Optional. Raises the Himalayas rate limit. |

The endpoint is in the [API reference](api.md#jobs).
